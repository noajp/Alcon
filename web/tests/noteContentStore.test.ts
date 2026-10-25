import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNoteContentStore } from '@/Function/notebook/noteContentStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Note autosave queue', () => {
  it('never writes on initial load, unchanged content, subscription or cleanup', async () => {
    const write = vi.fn();
    const store = createNoteContentStore({ read: async () => '<p>Saved</p>', write });
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
    const store = createNoteContentStore({ read: async (id) => id, write });
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
    const store = createNoteContentStore({ read: async () => 'saved', write });
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
    const store = createNoteContentStore({ read, write });
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
    const store = createNoteContentStore({ read, write });
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
    const store = createNoteContentStore({ read, write: vi.fn(async () => {}) });
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
    const store = createNoteContentStore({ read, write });
    await store.load('a');
    expect(store.getSnapshot('a')).toMatchObject({ ready: false, errorKind: 'read' });
    await store.retry('a');
    expect(store.getSnapshot('a')).toMatchObject({ ready: true, html: 'saved', error: null });
    expect(write).not.toHaveBeenCalled();
  });

  it('starts autosave only after the last edit has been idle for the debounce interval', async () => {
    const write = vi.fn(async () => {});
    const store = createNoteContentStore({ read: async () => 'saved', write });
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
