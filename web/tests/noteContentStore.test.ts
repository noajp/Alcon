// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteContentStore } from '@/Function/notebook/noteContentStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

/** The queue's own behaviour, with an adapter that knows nothing of versions. */
function storeOf(adapter: { read: (id: string) => Promise<string>; write: (id: string, html: string) => unknown }) {
  return createNoteContentStore({
    read: async (id) => ({ html: await adapter.read(id), stamp: null }),
    write: async (id, html) => { await adapter.write(id, html); return { stamp: 's' }; },
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Note autosave queue', () => {
  it('never writes on initial load, unchanged content, subscription or cleanup', async () => {
    const write = vi.fn();
    const store = storeOf({ read: async () => '<p>Saved</p>', write });
    const unsubscribe = store.subscribe('a', vi.fn());
    await store.load('a');
    store.edit('a', '<p>Saved</p>');
    unsubscribe();
    await store.flush('a');
    await vi.runAllTimersAsync();
    expect(write).not.toHaveBeenCalled();
    expect(store.getSnapshot('a')).toMatchObject({ html: '<p>Saved</p>', dirty: false, ready: true });
  });

  it('flushes the last A edit on an immediate A to B switch without changing B', async () => {
    const write = vi.fn(async () => {});
    const store = storeOf({ read: async (id) => id, write });
    await store.load('a');
    store.edit('a', 'A draft');
    // The hook calls flush from its old Note's effect cleanup, before the
    // debounce deadline, and independently starts the new Note read.
    const oldCleanup = store.flush('a');
    await store.load('b');
    await oldCleanup;
    expect(write).toHaveBeenCalledExactlyOnceWith('a', 'A draft');
    expect(store.getSnapshot('b').html).toBe('b');
    expect(store.getSnapshot('a').dirty).toBe(false);
    await vi.runAllTimersAsync();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('shares one queue across consumers and coalesces edits behind a slow write', async () => {
    const first = deferred<void>();
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const store = storeOf({ read: async () => 'saved', write });
    const widget = vi.fn();
    const notebook = vi.fn();
    store.subscribe('a', widget);
    store.subscribe('a', notebook);
    await store.load('a');
    store.edit('a', 'first');
    const pending = store.flush('a');
    await vi.advanceTimersByTimeAsync(0);
    store.edit('a', 'second');
    store.edit('a', 'latest');
    const secondConsumer = store.flush('a');
    expect(secondConsumer).toBe(pending);
    await vi.advanceTimersByTimeAsync(600);
    expect(write).toHaveBeenCalledTimes(1);
    first.resolve();
    await pending;
    expect(write.mock.calls).toEqual([['a', 'first'], ['a', 'latest']]);
    expect(widget).toHaveBeenCalledTimes(notebook.mock.calls.length);
    expect(store.getSnapshot('a')).toMatchObject({ html: 'latest', dirty: false, saving: false });
  });

  it('retains the newest failed draft across remounts and retries that draft', async () => {
    const first = deferred<void>();
    const read = vi.fn(async () => 'saved');
    const write = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValue(undefined);
    const store = storeOf({ read, write });
    await store.load('a');
    store.edit('a', 'first');
    const pending = store.flush('a');
    await vi.advanceTimersByTimeAsync(0);
    store.edit('a', 'newest draft');
    first.reject(new Error('offline'));
    await pending;
    await store.load('a');
    await vi.runAllTimersAsync();
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot('a')).toMatchObject({ html: 'newest draft', dirty: true, saving: false, errorKind: 'write' });
    expect(store.getSnapshot('a').error?.message).toBe('offline');
    await store.retry('a');
    expect(write).toHaveBeenLastCalledWith('a', 'newest draft');
    expect(store.getSnapshot('a')).toMatchObject({ dirty: false, error: null, saving: false });
  });

  it('ignores a stale read even when the newer edit has already finished saving', async () => {
    const stale = deferred<string>();
    const read = vi.fn().mockResolvedValueOnce('saved').mockImplementationOnce(() => stale.promise);
    const write = vi.fn(async () => {});
    const store = storeOf({ read, write });
    await store.load('a');
    const revalidation = store.load('a');
    store.edit('a', 'new body');
    await store.flush('a');
    stale.resolve('old server response');
    await revalidation;
    expect(store.getSnapshot('a')).toMatchObject({ html: 'new body', dirty: false, error: null });
  });

  it('keeps a warm editor mounted during revalidation and preserves retained drafts', async () => {
    const fresh = deferred<string>();
    const read = vi.fn().mockResolvedValueOnce('cached').mockImplementationOnce(() => fresh.promise);
    const store = storeOf({ read, write: vi.fn(async () => {}) });
    await store.load('a');
    const reopening = store.load('a');
    expect(store.getSnapshot('a')).toMatchObject({ html: 'cached', ready: true, loading: false });
    fresh.resolve('updated elsewhere');
    await reopening;
    expect(store.getSnapshot('a')).toMatchObject({ html: 'updated elsewhere', loading: false });
    store.edit('a', 'unsaved draft');
    await store.load('a');
    expect(read).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot('a')).toMatchObject({ html: 'unsaved draft', loading: false, dirty: true });
  });

  it('reports failed reads without marking the empty body ready, and retries only the read', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce('saved');
    const write = vi.fn(async () => {});
    const store = storeOf({ read, write });
    await store.load('a');
    expect(store.getSnapshot('a')).toMatchObject({ ready: false, errorKind: 'read' });
    await store.retry('a');
    expect(store.getSnapshot('a')).toMatchObject({ ready: true, html: 'saved', error: null });
    expect(write).not.toHaveBeenCalled();
  });

  it('starts autosave only after the last edit has been idle for the debounce interval', async () => {
    const write = vi.fn(async () => {});
    const store = storeOf({ read: async () => 'saved', write });
    await store.load('a');
    store.edit('a', 'first');
    await vi.advanceTimersByTimeAsync(400);
    store.edit('a', 'latest');
    await vi.advanceTimersByTimeAsync(499);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledExactlyOnceWith('a', 'latest');
  });
});

/** A server row: its body and version, saved only over the version it holds. */
function server(html: string) {
  let row = { html, stamp: 'v0' };
  let n = 0;
  return {
    get row() { return row; },
    /** Someone else saves. */
    set(next: string) { row = { html: next, stamp: `v${++n}` }; return row; },
    adapter: {
      read: vi.fn(async () => ({ ...row })),
      write: vi.fn(async (_id: string, next: string, stamp: string | null) => {
        if (stamp !== row.stamp) return 'conflict' as const;
        row = { html: next, stamp: `v${++n}` };
        return { stamp: row.stamp };
      }),
    },
  };
}

describe('Note editing by several people', () => {
  it('merges a save that lost the race with what was saved first', async () => {
    const db = server('<p>a</p><p>b</p>');
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.edit('n', '<p>A</p><p>b</p>');
    db.set('<p>a</p><p>B</p>');
    await store.flush('n');
    expect(db.row.html).toBe('<p>A</p><p>B</p>');
    expect(store.getSnapshot('n')).toMatchObject({ html: '<p>A</p><p>B</p>', dirty: false });
    expect(db.adapter.write).toHaveBeenCalledTimes(2);
  });

  it('takes a live change as it is when nothing is unsaved, and merges it into a draft', async () => {
    const db = server('<p>a</p><p>b</p>');
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.receive('n', db.set('<p>a</p><p>B</p>'));
    expect(store.getSnapshot('n')).toMatchObject({ html: '<p>a</p><p>B</p>', dirty: false });
    store.edit('n', '<p>A</p><p>B</p>');
    store.receive('n', db.set('<p>a</p><p>B</p><p>c</p>'));
    expect(store.getSnapshot('n').html).toBe('<p>A</p><p>B</p><p>c</p>');
    await vi.runAllTimersAsync();
    expect(db.row.html).toBe('<p>A</p><p>B</p><p>c</p>');
    expect(db.adapter.write).toHaveBeenCalledTimes(1);
  });

  it('ignores its own save coming back, and looks again at a change that came mid-save', async () => {
    const db = server('<p>a</p>');
    const gate = deferred<void>();
    const write = db.adapter.write;
    db.adapter.write = vi.fn(async (id: string, next: string, stamp: string | null) => { await gate.promise; return write(id, next, stamp); });
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.edit('n', '<p>mine</p>');
    const saving = store.flush('n');
    await vi.advanceTimersByTimeAsync(0);
    // Arrives while the save runs: held, then read again after it.
    store.receive('n', { html: '<p>noise</p>', stamp: 'elsewhere' });
    gate.resolve();
    await saving;
    await vi.runAllTimersAsync();
    expect(db.adapter.read).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot('n')).toMatchObject({ html: '<p>mine</p>', dirty: false });
    store.receive('n', { ...db.row });
    expect(store.getSnapshot('n').html).toBe('<p>mine</p>');
  });
});

describe('saving in place of the one who saves a Note edited together', () => {
  it('saves when nobody else does', async () => {
    const db = server('<p>a</p>');
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.edit('n', '<p>ab</p>', { standIn: true });
    await vi.runAllTimersAsync();
    expect(db.row.html).toBe('<p>ab</p>');
    expect(store.getSnapshot('n')).toMatchObject({ html: '<p>ab</p>', dirty: false });
  });

  it('stands down, unsaved and unmerged, when someone else saves first', async () => {
    const db = server('<p>a</p><p>b</p>');
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.edit('n', '<p>a!</p><p>b</p>', { standIn: true });
    // The one who saves was only slow: a newer body of the same Note lands.
    store.receive('n', db.set('<p>a!?</p><p>b</p>'));
    expect(store.getSnapshot('n')).toMatchObject({ html: '<p>a!?</p><p>b</p>', dirty: false });
    await vi.runAllTimersAsync();
    expect(db.adapter.write).not.toHaveBeenCalled();
    expect(db.row.html).toBe('<p>a!?</p><p>b</p>');
  });

  it('stands down when its save loses the race, without saving again', async () => {
    const db = server('<p>a</p>');
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.edit('n', '<p>mine</p>', { standIn: true });
    db.set('<p>theirs</p>');                         // saved first, not yet heard of here
    await store.flush('n');
    expect(db.adapter.write).toHaveBeenCalledTimes(1);
    expect(db.row.html).toBe('<p>theirs</p>');
    expect(store.getSnapshot('n')).toMatchObject({ html: '<p>theirs</p>', dirty: false });
  });

  it("never turns this side's own unsaved draft into one that stands down", async () => {
    const db = server('<p>a</p><p>b</p>');
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.edit('n', '<p>A</p><p>b</p>');
    store.edit('n', '<p>A!</p><p>b</p>', { standIn: true });
    store.receive('n', db.set('<p>a</p><p>B</p>'));
    await vi.runAllTimersAsync();
    expect(db.row.html).toBe('<p>A!</p><p>B</p>');
  });

  it('saves a draft of its own made after standing in as its own', async () => {
    const db = server('<p>a</p><p>b</p>');
    const store = createNoteContentStore(db.adapter);
    await store.load('n');
    store.edit('n', '<p>a!</p><p>b</p>', { standIn: true });
    store.edit('n', '<p>a!</p><p>b?</p>');
    store.receive('n', db.set('<p>a</p><p>b</p><p>c</p>'));
    await vi.runAllTimersAsync();
    expect(db.row.html).toBe('<p>a!</p><p>b?</p><p>c</p>');
  });
});
