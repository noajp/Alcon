// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { ySyncPlugin, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { FRAGMENT, hashText, seedFromHtml, seedId } from '@/Function/notebook/pm/collab';
import { docToHtml } from '@/Function/notebook/pm/html';
import { schema } from '@/Function/notebook/pm/schema';
import { createNoteCollabHub, olderLineage, type CollabEvent, type NoteCollab } from '@/hooks/noteCollab';
import type { retainChannel } from '@/hooks/sharedRealtime';

const html = '<h1>Plan</h1><ul data-checklist="true"><li data-element-id="e1">Ship</li></ul>';
const read = (doc: Y.Doc) => docToHtml(yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(FRAGMENT), schema));

describe('starting a shared Note', () => {
  it('fills an empty shared document with the saved body, and names that body', () => {
    const doc = new Y.Doc();
    expect(seedFromHtml(doc, html)).toBe(seedId(html));
    expect(read(doc)).toBe(html);
  });

  it('two people starting at once end with one copy, not two', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    seedFromHtml(a, html);
    seedFromHtml(b, html);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(read(a)).toBe(html);
    expect(read(b)).toBe(html);
  });

  it('leaves a document someone is already editing alone', () => {
    const doc = new Y.Doc();
    seedFromHtml(doc, '<p>first</p>');
    seedFromHtml(doc, '<p>second</p>');
    expect(read(doc)).toBe('<p>first</p>');
  });

  it('names different bodies differently, the same body the same', () => {
    expect(hashText('x')).toBe(hashText('x'));
    expect(hashText('')).toBeGreaterThan(0);
    expect(seedId('<p>a</p>')).toBe(seedId('<p>a</p>'));
    expect(seedId('<p>a</p>')).not.toBe(seedId('<p>b</p>'));
  });

  it('the older of two documents is the one kept', () => {
    expect(olderLineage({ id: 'b', born: 1 }, { id: 'a', born: 2 })).toBe(true);
    expect(olderLineage({ id: 'a', born: 2 }, { id: 'b', born: 2 })).toBe(true);
    expect(olderLineage({ id: 'b', born: 2 }, { id: 'a', born: 2 })).toBe(false);
  });
});

// ── Several tabs on one wire ─────────────────────────────────────────────
// A wire that behaves as the Note's broadcast channel does: a message goes to
// everyone else joined, never to its sender; it can be held back or dropped.

type Handler = (message: { payload: unknown }) => void;
class Net {
  queue: (() => void)[] = [];
  joined = new Set<Line>();
  held = false;
  dropping = 0;
  sent = 0;
  run() { if (!this.held) while (this.queue.length) this.queue.shift()!(); }
}
class Line {
  handlers: Handler[] = [];
  status: (status: string) => void = () => {};
  constructor(private net: Net) {}
  on(_type: string, _filter: unknown, handler: Handler) { this.handlers.push(handler); return this; }
  send(message: { payload: unknown }) {
    if (!this.net.joined.has(this)) return Promise.resolve('error');
    this.net.sent += 1;
    if (this.net.dropping > 0) { this.net.dropping -= 1; return Promise.resolve('ok'); }
    const payload = JSON.parse(JSON.stringify(message.payload)) as unknown;
    this.net.queue.push(() => { for (const other of this.net.joined) if (other !== this) other.handlers.forEach((h) => h({ payload })); });
    return Promise.resolve('ok');
  }
  join() { this.net.joined.add(this); this.status('SUBSCRIBED'); }
  drop() { this.net.joined.delete(this); this.status('CLOSED'); }
}

/** One tab: its sessions, and its line for the Note (kept while anything holds it, as the app's shared channels are). */
function tab(net: Net) {
  let line: Line | null = null;
  let count = 0;
  let closing: ReturnType<typeof setTimeout> | null = null;
  const retain: typeof retainChannel = (_topic, build, setup = {}) => {
    if (closing) { clearTimeout(closing); closing = null; }
    if (!line) {
      const made = new Line(net);
      line = made;
      made.status = (status) => setup.onStatus?.(status);
      build(made as unknown as RealtimeChannel);
      net.queue.push(() => { if (line === made) made.join(); });
    }
    count += 1;
    return () => {
      count -= 1;
      if (count === 0) closing = setTimeout(() => { line?.drop(); line = null; closing = null; }, 50);
    };
  };
  return { open: createNoteCollabHub(retain), line: () => line! };
}

const NOTE = '11111111-1111-4111-8111-111111111111';

/** Lets timers and the wire run for `ms`. */
async function pass(net: Net, ms = 400) {
  for (let t = 0; t < ms; t += 20) { await vi.advanceTimersByTimeAsync(20); net.run(); }
}

/** A session started from a saved body, with what it told its editor. */
function begin(session: NoteCollab, saved: string) {
  const events: CollabEvent[] = [];
  session.subscribe((event) => events.push(event));
  session.start((doc) => seedFromHtml(doc, saved));
  return events;
}

/** Types `text` at the end of the first block, as an editor bound to the session would. */
function type(session: NoteCollab, text: string) {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ schema, plugins: [ySyncPlugin(session.doc.getXmlFragment(FRAGMENT))] }),
  });
  view.dispatch(view.state.tr.insertText(text, view.state.doc.firstChild!.nodeSize - 1));
  view.destroy();
}

/** Deletes the first block's last character. */
function erase(session: NoteCollab) {
  const view = new EditorView(document.createElement('div'), {
    state: EditorState.create({ schema, plugins: [ySyncPlugin(session.doc.getXmlFragment(FRAGMENT))] }),
  });
  const end = view.state.doc.firstChild!.nodeSize - 1;
  view.dispatch(view.state.tr.delete(end - 1, end));
  view.destroy();
}

describe('the wire between people editing one Note', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2027-01-08T09:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('has the body ready the moment the Note is opened, with nobody else there', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    begin(a, html);
    expect(a.ready).toBe(true);
    expect(read(a.doc)).toBe(html);
    expect(a.isSaver()).toBe(true);
    await pass(net);
    expect(read(a.doc)).toBe(html);
  });

  it('two people opening at the same moment hold the body once — not none of it, not twice', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    const b = tab(net).open(NOTE);
    begin(a, html);
    begin(b, html);
    await pass(net);
    expect(read(a.doc)).toBe(html);
    expect(read(b.doc)).toBe(html);
    type(a, ' A');
    type(b, ' B');
    await pass(net);
    expect(read(a.doc)).toBe(read(b.doc));
    expect(read(a.doc)).toContain('Plan');
    expect(read(a.doc).match(/Ship/g)).toHaveLength(1);
  });

  it('someone who opens later while the other is slow to answer takes their document — the body is not doubled', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    begin(a, '<p>one</p><p>two</p>');
    await pass(net);
    type(a, '!');
    const saved = read(a.doc);                      // what A saved: the body moved on from A's start
    await pass(net);

    await vi.advanceTimersByTimeAsync(1000);        // B is born later than A's document
    net.held = true;                                // A's tab sleeps: nothing passes
    const b = tab(net).open(NOTE);
    const told = begin(b, saved);
    expect(b.ready).toBe(true);                     // B is not kept waiting
    await pass(net, 3000);
    net.held = false;
    await pass(net, 1000);

    expect(told).toContain('replaced');             // B gave way to the older document
    expect(b.ready).toBe(true);
    expect(read(a.doc)).toBe(saved);
    expect(read(b.doc)).toBe(saved);
    type(b, '?');
    await pass(net);
    expect(read(a.doc)).toBe('<p>one!?</p><p>two</p>');
  });

  it('never saves from a document it is still waiting for', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    begin(a, '<p>old</p>');
    await pass(net);
    type(a, 'er');
    await pass(net);
    await vi.advanceTimersByTimeAsync(1000);
    net.held = true;
    const b = tab(net).open(NOTE);
    const told = begin(b, '<p>older</p>');
    net.held = false;
    // Step until B has given way and before it is answered.
    for (let i = 0; i < 50 && !told.includes('replaced'); i++) { await vi.advanceTimersByTimeAsync(20); if (net.queue.length) net.queue.shift()!(); }
    expect(told).toContain('replaced');
    if (!b.ready) {
      expect(b.isSaver()).toBe(false);
      expect(b.doc.getXmlFragment(FRAGMENT).length).toBe(0);
    }
    await pass(net, 1500);
    expect(b.ready).toBe(true);
    expect(read(b.doc)).toBe('<p>older</p>');
  });

  it('starts over from the saved body when the document it gave way to never comes', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    begin(a, '<p>one</p>');
    await pass(net);
    type(a, '!');
    await pass(net);
    await vi.advanceTimersByTimeAsync(1000);
    const b = tab(net).open(NOTE);
    const told = begin(b, '<p>one!</p>');
    // B hears of A's document, gives way — and A is gone before it answers.
    for (let i = 0; i < 100 && !told.includes('replaced'); i++) { await vi.advanceTimersByTimeAsync(20); if (net.queue.length) net.queue.shift()!(); }
    expect(told).toContain('replaced');
    net.queue = [];
    a.release();
    net.dropping = Infinity;                        // nothing A says on its way out arrives
    await pass(net, 200);
    net.dropping = 0;
    await pass(net, 6000);
    expect(b.ready).toBe(true);
    expect(read(b.doc)).toBe('<p>one!</p>');
    expect(b.isSaver()).toBe(true);
  });

  it('makes up for a message that was lost — typed text and deleted text alike', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    const b = tab(net).open(NOTE);
    begin(a, '<p>hello</p>');
    begin(b, '<p>hello</p>');
    await pass(net);

    net.dropping = 1;
    type(a, ' world');
    await pass(net, 200);
    expect(read(b.doc)).toBe('<p>hello</p>');       // the message was lost
    await pass(net, 5000);                          // …and made up for
    expect(read(b.doc)).toBe('<p>hello world</p>');

    net.dropping = 1;
    erase(a);
    await pass(net, 200);
    expect(read(b.doc)).toBe('<p>hello world</p>');
    await pass(net, 5000);
    expect(read(b.doc)).toBe('<p>hello worl</p>');
    expect(read(a.doc)).toBe('<p>hello worl</p>');
  });

  it('trades what each typed while one was off the wire', async () => {
    const net = new Net();
    const ta = tab(net);
    const a = ta.open(NOTE);
    const b = tab(net).open(NOTE);
    begin(a, '<p>x</p><p>y</p>');
    begin(b, '<p>x</p><p>y</p>');
    await pass(net);
    ta.line().drop();
    type(a, 'A');
    type(b, 'B');
    await pass(net, 500);
    expect(read(b.doc)).toBe('<p>xB</p><p>y</p>');
    ta.line().join();
    await pass(net, 1500);
    expect(read(a.doc)).toBe(read(b.doc));
    expect(read(a.doc)).toMatch(/^<p>x(AB|BA)<\/p><p>y<\/p>$/);
  });

  it('is quiet when everyone holds the same', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    const b = tab(net).open(NOTE);
    begin(a, html);
    begin(b, html);
    type(a, '!');
    erase(a);
    await pass(net, 2000);
    const before = net.sent;
    await pass(net, 20_000);
    // Each side says what it holds every few seconds; nobody has to answer.
    expect(net.sent - before).toBeLessThanOrEqual(14);
  });

  it('the one who has had the Note open longest saves; when they leave, the next does', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    begin(a, html);
    await pass(net);
    await vi.advanceTimersByTimeAsync(5000);
    const b = tab(net).open(NOTE);
    begin(b, html);
    await pass(net);
    expect(a.isSaver()).toBe(true);
    expect(b.isSaver()).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    const c = tab(net).open(NOTE);                   // a newcomer never takes the saving over
    begin(c, html);
    await pass(net);
    expect([a.isSaver(), b.isSaver(), c.isSaver()]).toEqual([true, false, false]);

    a.release();
    await pass(net);
    expect([b.isSaver(), c.isSaver()]).toEqual([true, false]);
  });

  it('closing the tab hands the saving over at once', async () => {
    const net = new Net();
    const a = tab(net).open(NOTE);
    begin(a, html);
    await pass(net);
    await vi.advanceTimersByTimeAsync(5000);
    const b = tab(net).open(NOTE);
    begin(b, html);
    await pass(net);
    expect(b.isSaver()).toBe(false);
    // Both tabs share this one window here, so A alone is told its page is going.
    (a as unknown as { onPageHide(): void }).onPageHide();
    await pass(net, 200);
    expect(b.isSaver()).toBe(true);
  });

  it('hands a large document over in parts', async () => {
    const net = new Net();
    const big = `<p>${'lorem ipsum dolor sit amet '.repeat(9000)}</p>`;
    const a = tab(net).open(NOTE);
    begin(a, big);
    await pass(net);
    type(a, '!');
    const saved = read(a.doc);
    await pass(net);
    await vi.advanceTimersByTimeAsync(1000);
    const b = tab(net).open(NOTE);
    const told = begin(b, saved);
    await pass(net, 2000);
    expect(told).toContain('replaced');
    expect(read(b.doc)).toBe(saved);
  });

  it('one tab holds one session for a Note, and keeps it across a remount', async () => {
    const net = new Net();
    const open = tab(net).open;
    const first = open(NOTE);
    begin(first, html);
    const second = open(NOTE);
    expect(second.doc).toBe(first.doc);
    type(first, '!');
    const doc = first.doc;
    first.release();
    second.release();
    await vi.advanceTimersByTimeAsync(20);           // an editor remounting
    const again = open(NOTE);
    expect(again.doc).toBe(doc);
    expect(read(again.doc)).toContain('Plan!');
    again.release();
    await pass(net, 500);
    const fresh = open(NOTE);
    expect(fresh.doc).not.toBe(doc);
    fresh.release();
  });

  it('ignores what it cannot read', async () => {
    const net = new Net();
    const ta = tab(net);
    const a = ta.open(NOTE);
    const b = tab(net).open(NOTE);
    begin(a, '<p>x</p>');
    begin(b, '<p>x</p>');
    await pass(net);
    for (const payload of [null, 'text', { l: 'zz', b: 'x', u: '***' }, { c: 1, l: seedId('<p>x</p>'), b: 0, u: 'AAAA' }, { p: 'p', i: 9, of: 2, d: '' }]) {
      void ta.line().send({ payload });
    }
    await pass(net);
    type(a, '!');
    await pass(net);
    expect(read(b.doc)).toBe('<p>x!</p>');
  });
});
