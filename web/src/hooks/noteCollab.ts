'use client';

import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { fromBase64, toBase64 } from 'lib0/buffer';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { retainChannel } from './sharedRealtime';

// Editing one Note together: its shared document (Yjs) and where everyone's
// cursor is, carried on the Note's private broadcast channel `note-edit:<id>`
// (only those who can write the Note may join it — migration 20270108090000).
//
// There is no server copy of the shared document. Whoever has the Note open
// holds it; the Note's saved HTML stays the record. What that asks of the wire:
//
// - A document starts from the saved body, the same way for everyone who
//   starts from the same body (its *lineage*), so their copies are one
//   document and merge exactly. Two documents started from different bodies
//   are different lineages and are never merged — merging them would write
//   the text twice. The younger gives way: it drops its copy and takes the
//   older whole. What it had typed is not lost; it was saved as HTML, and
//   saved bodies are merged paragraph by paragraph as they always were.
// - A message can be lost. Everyone says now and then what they hold; whoever
//   holds more sends it, whoever holds less asks.
// - One side saves the shared body: the one who has had the Note open longest
//   (isSaver). The others watch that it is saved (the editor's business).
// - One browser tab holds one session per Note, however many editors show it.

const REMOTE = Symbol('note-collab-remote');
const EVENT = 'y';

/** Outgoing edits and cursor moves are gathered this long into one message. */
const FLUSH_MS = 60;
/** How often each side says what it holds, in case a message was lost. */
const RESYNC_MS = 3000;
/** At most one "send me what I lack" per this long. */
const ASK_GAP_MS = 400;
/** A side that gave way asks again this often until it has the document. */
const FOLLOW_ASK_MS = 1000;
/** How long a side that gave way waits for the document before starting over from the saved body. */
const FOLLOW_MS = 4000;
/** An editor that remounts (a view switch, React's double effect) keeps its session this long. */
const LINGER_MS = 80;
/** A message larger than this many characters is sent in parts. */
const PART_CHARS = 100_000;
/** Parts of a message that never completed are dropped after this long. */
const PART_STALE_MS = 30_000;

/** Where a shared document comes from: the body it was started from, and when. */
interface Lineage { id: string; born: number }

/** 'replaced': this side gave way and holds a new, empty document to bind to.
 *  'ready': it holds a document to edit, or has caught up after missing some.
 *  'peers': who is here, or what they say of themselves, changed. */
export type CollabEvent = 'replaced' | 'ready' | 'peers';

/** How a person shows to the others: their name and which of the cursor colours is theirs. */
export interface CollabUser { name: string; tone: number }

export interface NoteCollab {
  /** The shared document and who is where. Both are replaced on 'replaced'. */
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  /** Whether this side holds a document to edit (not while it waits for the one it gave way to). */
  readonly ready: boolean;
  /** Starts the shared document unless it has one. `seed` fills an empty
   *  document from the saved body and names that body; it is called again if
   *  this side must start over. */
  start(seed: (doc: Y.Doc) => string): void;
  /** Whether this side is the one that saves the shared body. */
  isSaver(): boolean;
  setUser(user: CollabUser): void;
  subscribe(listener: (event: CollabEvent) => void): () => void;
  /** This editor is done with the session. */
  release(): void;
}

/** Pure. Whether lineage `a` is the one `b` gives way to. */
export function olderLineage(a: Lineage, b: Lineage): boolean {
  return a.born < b.born || (a.born === b.born && a.id < b.id);
}

/** A number for everything deleted in a document, the same on every side that
 *  holds the same deletions (a state vector does not say what was deleted). */
function deletedDigest(doc: Y.Doc): number {
  let sum = 0;
  Y.snapshot(doc).ds.clients.forEach((items, client) => {
    for (const item of items) {
      let h = 0x811c9dc5;
      for (const n of [client, item.clock, item.len]) { h ^= n; h = Math.imul(h, 0x01000193); h ^= h >>> 13; }
      sum = (sum + (h >>> 0)) >>> 0;
    }
  });
  return sum;
}

/** Whether `doc` holds edits the holder of state vector `theirs` lacks. */
function holdsMoreThan(doc: Y.Doc, theirs: Map<number, number>): boolean {
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(doc))) {
    if (clock > (theirs.get(client) ?? 0)) return true;
  }
  return false;
}

/** Whether the holder of state vector `theirs` holds edits `doc` lacks. */
function lacksSomeOf(doc: Y.Doc, theirs: Map<number, number>): boolean {
  for (const [client, clock] of theirs) if (clock > Y.getState(doc.store, client)) return true;
  return false;
}

// ── The wire: one channel per Note, shared and reopened by sharedRealtime ──

interface Wire { channel: RealtimeChannel | null; open: boolean }

/** One browser tab's sessions and the channels they speak on. */
interface Hub {
  wires: Map<string, Wire>;
  sessions: Map<string, Session>;
  retain: typeof retainChannel;
}

function retainWire(hub: Hub, noteId: string): () => void {
  let wire = hub.wires.get(noteId);
  if (!wire) { wire = { channel: null, open: false }; hub.wires.set(noteId, wire); }
  const w = wire;
  return hub.retain(`note-edit:${noteId}`, (channel) => {
    w.channel = channel;
    w.open = false;
    return channel.on('broadcast', { event: EVENT }, ({ payload }) => hub.sessions.get(noteId)?.receive(payload));
  }, {
    config: { private: true, broadcast: { self: false } },
    onStatus: (status) => {
      w.open = status === 'SUBSCRIBED';
      if (w.open) hub.sessions.get(noteId)?.opened();
    },
  });
}

interface Outbox {
  /** Say what this side holds, so the others send what it lacks. */
  ask: boolean;
  updates: Uint8Array[];
  /** Whose presence changed, in the current awareness. */
  aw: Set<number>;
  /** Presence already written out (of a document since replaced). */
  awBytes: Uint8Array[];
  replies: Map<number, Uint8Array>;
}
const emptyOutbox = (): Outbox => ({ ask: false, updates: [], aw: new Set(), awBytes: [], replies: new Map() });

class Session implements NoteCollab {
  doc = new Y.Doc();
  awareness = new Awareness(this.doc);
  private lineage: Lineage | null = null;
  /** Gave way: waiting for the older document. */
  private following = false;
  /** Holds the whole of its lineage (as far as it was told). */
  private synced = false;
  private seed: ((doc: Y.Doc) => string) | null = null;
  private user: CollabUser | null = null;
  private readonly since = Date.now();
  private readonly listeners = new Set<(event: CollabEvent) => void>();
  private refs = 0;
  private out = emptyOutbox();
  private lastAsk = 0;
  private lastDigestAsk = 0;
  private sent = 0;
  private readonly parts = new Map<string, { at: number; got: number; pieces: string[] }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private askTimer: ReturnType<typeof setTimeout> | null = null;
  private followTimer: ReturnType<typeof setTimeout> | null = null;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resyncTimer: ReturnType<typeof setInterval>;
  private readonly releaseWire: () => void;
  private gone = false;

  constructor(private readonly hub: Hub, private readonly noteId: string) {
    this.attach();
    this.describe();
    this.resyncTimer = setInterval(() => this.ask(), RESYNC_MS + Math.floor(Math.random() * 1000));
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this.onPageHide);
      window.addEventListener('pageshow', this.onPageShow);
    }
    this.releaseWire = retainWire(hub, noteId);
    if (hub.wires.get(noteId)?.open) this.opened();
  }

  // ── What an editor asks ────────────────────────────────────────────────

  get ready(): boolean { return !!this.lineage && this.synced; }

  /** Holds a document with nothing known to be missing: fit to save. */
  private whole(): boolean {
    return this.ready && !this.doc.store.pendingStructs && !this.doc.store.pendingDs;
  }

  start(seed: (doc: Y.Doc) => string): void {
    this.seed = seed;
    if (!this.lineage && !this.following) this.begin();
  }

  // The one who has had the Note open longest saves, so two saves never
  // cross and a newcomer never saves a document it has only part of.
  isSaver(): boolean {
    if (!this.whole()) return false;
    const mine = this.lineage!.id;
    let first: { since: number; id: number } | null = null;
    this.awareness.getStates().forEach((state, id) => {
      if (state?.l !== mine) return;
      const since = typeof state.since === 'number' && Number.isFinite(state.since) ? state.since : Infinity;
      if (!first || since < first.since || (since === first.since && id < first.id)) first = { since, id };
    });
    return !first || (first as { id: number }).id === this.doc.clientID;
  }

  setUser(user: CollabUser): void {
    this.user = user;
    this.describe();
  }

  subscribe(listener: (event: CollabEvent) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  retain(): this {
    if (this.lingerTimer) { clearTimeout(this.lingerTimer); this.lingerTimer = null; }
    this.refs += 1;
    return this;
  }

  release(): void {
    this.refs -= 1;
    if (this.refs > 0 || this.lingerTimer) return;
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      if (this.refs <= 0) this.destroy();
    }, LINGER_MS);
  }

  // ── The document ───────────────────────────────────────────────────────

  private emit(event: CollabEvent) {
    for (const listener of [...this.listeners]) listener(event);
  }

  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || !this.lineage) return;
    this.out.updates.push(update);
    this.schedule();
  };

  private readonly onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE) return;
    for (const id of [...added, ...updated, ...removed]) this.out.aw.add(id);
    this.schedule();
  };

  private readonly onPeers = () => this.emit('peers');

  private attach() {
    this.doc.on('update', this.onUpdate);
    this.awareness.on('update', this.onAwareness);
    this.awareness.on('change', this.onPeers);
  }

  private detach(doc: Y.Doc, awareness: Awareness) {
    doc.off('update', this.onUpdate);
    awareness.off('update', this.onAwareness);
    awareness.off('change', this.onPeers);
  }

  /** What this side says of itself to the others. */
  private describe() {
    this.awareness.setLocalState({
      ...(this.awareness.getLocalState() ?? {}),
      since: this.since, l: this.lineage?.id ?? null, user: this.user,
    });
  }

  /** Starts a document of its own from the saved body. */
  private begin() {
    if (!this.seed) return;
    const id = this.seed(this.doc);
    this.lineage = { id, born: Date.now() };
    this.synced = true;
    this.following = false;
    if (this.followTimer) { clearTimeout(this.followTimer); this.followTimer = null; }
    this.describe();
    this.ask();
    this.emit('ready');
  }

  /** Drops this side's document for a new, empty one. Editors rebind on
   *  'replaced', while the old document is still whole. */
  private swap() {
    const old = { doc: this.doc, awareness: this.awareness };
    this.detach(old.doc, old.awareness);
    removeAwarenessStates(old.awareness, [old.doc.clientID], 'replaced');
    this.out = { ...emptyOutbox(), awBytes: [...this.out.awBytes, encodeAwarenessUpdate(old.awareness, [old.doc.clientID])] };
    this.doc = new Y.Doc();
    this.awareness = new Awareness(this.doc);
    this.lineage = null;
    this.synced = false;
    this.attach();
    this.describe();
    this.emit('replaced');
    old.awareness.destroy();
    old.doc.destroy();
  }

  /** An older document exists: take it in place of this side's. */
  private giveWay() {
    this.swap();
    this.following = true;
    this.ask();
    if (this.followTimer) clearTimeout(this.followTimer);
    this.followTimer = setTimeout(() => this.orphaned(), FOLLOW_MS);
  }

  /** Nobody sent the document this side gave way to: start over. */
  private orphaned() {
    this.followTimer = null;
    if (this.synced || this.gone) return;
    if (this.lineage) this.swap();
    this.begin();
  }

  private caughtUp() {
    this.synced = true;
    this.following = false;
    if (this.followTimer) { clearTimeout(this.followTimer); this.followTimer = null; }
    this.emit('ready');
  }

  private apply(update: Uint8Array) {
    const wasWhole = this.whole();
    Y.applyUpdate(this.doc, update, REMOTE);
    if (this.doc.store.pendingStructs || this.doc.store.pendingDs) this.askSoon();
    else if (!wasWhole && this.whole()) this.emit('ready');
  }

  // ── Sending ────────────────────────────────────────────────────────────

  private schedule() {
    if (this.flushTimer === null && !this.gone) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private ask() {
    if (!this.lineage && !this.following) return;
    this.out.ask = true;
    this.schedule();
  }

  private askSoon() {
    const wait = ASK_GAP_MS - (Date.now() - this.lastAsk);
    if (wait <= 0) { this.ask(); return; }
    if (!this.askTimer) this.askTimer = setTimeout(() => { this.askTimer = null; this.ask(); }, wait);
  }

  private flush() {
    if (this.flushTimer !== null) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    const out = this.out;
    this.out = emptyOutbox();
    const wire = this.hub.wires.get(this.noteId);
    // Off the wire: what was missed either way is traded when it is back.
    if (!wire?.open || !wire.channel) return;
    const head = { c: this.doc.clientID, l: this.lineage?.id ?? null, b: this.lineage?.born ?? 0 };
    const body: Record<string, unknown> = { ...head };
    if (out.updates.length) body.u = toBase64(out.updates.length === 1 ? out.updates[0] : Y.mergeUpdates(out.updates));
    const presence = [...out.awBytes];
    const changed = [...out.aw].filter((id) => this.awareness.meta.has(id));
    if (changed.length) presence.push(encodeAwarenessUpdate(this.awareness, changed));
    if (presence.length) body.a = presence.map((bytes) => toBase64(bytes));
    if (out.ask) {
      body.sv = toBase64(Y.encodeStateVector(this.doc));
      body.d = deletedDigest(this.doc);
      if (!this.synced) body.n = 1;
      this.lastAsk = Date.now();
      // Still without the document: keep asking until someone sends it.
      if (this.following && !this.askTimer) {
        this.askTimer = setTimeout(() => { this.askTimer = null; if (this.following && !this.synced) this.ask(); }, FOLLOW_ASK_MS);
      }
    }
    if (body.u || body.a || body.sv) this.send(wire.channel, body);
    out.replies.forEach((u, to) => this.send(wire.channel!, { ...head, to, u: toBase64(u) }));
  }

  private send(channel: RealtimeChannel, body: Record<string, unknown>) {
    const text = JSON.stringify(body);
    if (text.length <= PART_CHARS) {
      void channel.send({ type: 'broadcast', event: EVENT, payload: body });
      return;
    }
    const p = `${this.doc.clientID}.${++this.sent}`;
    const of = Math.ceil(text.length / PART_CHARS);
    for (let i = 0; i < of; i++) {
      void channel.send({ type: 'broadcast', event: EVENT, payload: { p, i, of, d: text.slice(i * PART_CHARS, (i + 1) * PART_CHARS) } });
    }
  }

  // ── Receiving ──────────────────────────────────────────────────────────

  /** The wire is joined (again): say who is here and trade what was missed. */
  opened() {
    if (this.gone) return;
    this.out.aw.add(this.doc.clientID);
    this.schedule();
    this.ask();
  }

  receive(payload: unknown) {
    if (this.gone) return;
    try {
      const whole = this.assemble(payload);
      if (whole) this.handle(whole);
    } catch {
      // A message this side cannot read. What it carried is made up for the
      // next time the two say what they hold.
    }
  }

  /** A message sent in parts, once all of it is here. */
  private assemble(payload: unknown): Record<string, unknown> | null {
    if (!payload || typeof payload !== 'object') return null;
    const m = payload as Record<string, unknown>;
    if (typeof m.p !== 'string') return m;
    const { p, i, of, d } = m;
    if (typeof i !== 'number' || typeof of !== 'number' || typeof d !== 'string' || i < 0 || i >= of || of > 1000) return null;
    const now = Date.now();
    this.parts.forEach((part, key) => { if (now - part.at > PART_STALE_MS) this.parts.delete(key); });
    let part = this.parts.get(p);
    if (!part) { part = { at: now, got: 0, pieces: new Array<string>(of) }; this.parts.set(p, part); }
    if (part.pieces.length !== of) return null;
    if (part.pieces[i] === undefined) { part.pieces[i] = d; part.got += 1; }
    if (part.got < of) return null;
    this.parts.delete(p);
    const whole: unknown = JSON.parse(part.pieces.join(''));
    return whole && typeof whole === 'object' ? (whole as Record<string, unknown>) : null;
  }

  private handle(m: Record<string, unknown>) {
    const from = typeof m.c === 'number' ? m.c : null;
    if (from === this.doc.clientID) return;
    // Someone this side has not met: they have not met it either.
    if (from !== null && !this.awareness.getStates().has(from)) {
      this.out.aw.add(this.doc.clientID);
      this.schedule();
    }
    if (Array.isArray(m.a)) {
      for (const bytes of m.a) if (typeof bytes === 'string') applyAwarenessUpdate(this.awareness, fromBase64(bytes), REMOTE);
    }
    const theirs: Lineage | null = typeof m.l === 'string' ? { id: m.l, born: typeof m.b === 'number' ? m.b : 0 } : null;
    const sv = typeof m.sv === 'string' ? fromBase64(m.sv) : null;
    const update = typeof m.u === 'string' ? fromBase64(m.u) : null;
    const forMe = m.to === this.doc.clientID;

    // Someone with no document yet, asking for one.
    if (!theirs) {
      if (sv && from !== null && this.whole()) this.reply(from, sv);
      return;
    }
    // This side has none: take theirs (only after giving way — before it has
    // started, it will start from the saved body like everyone else).
    if (!this.lineage) {
      if (!this.following || !update) return;
      this.lineage = { ...theirs };
      this.describe();
      this.apply(update);
      if (forMe) this.caughtUp(); else this.askSoon();
      return;
    }
    // Two documents started from different bodies: never merged. The younger
    // gives way; the older says so, so the younger hears of it.
    if (theirs.id !== this.lineage.id) {
      if (olderLineage(theirs, this.lineage)) this.giveWay(); else this.askSoon();
      return;
    }
    if (theirs.born < this.lineage.born) this.lineage.born = theirs.born;
    if (update) {
      this.apply(update);
      if (!this.synced && forMe) this.caughtUp();
    }
    if (sv && from !== null) {
      const held = Y.decodeStateVector(sv);
      const deletedDiffers = typeof m.d === 'number' && m.d !== deletedDigest(this.doc);
      if (this.whole() && (m.n === 1 || deletedDiffers || holdsMoreThan(this.doc, held))) this.reply(from, sv);
      if (lacksSomeOf(this.doc, held)) this.askSoon();
      else if (deletedDiffers && Date.now() - this.lastDigestAsk > RESYNC_MS) { this.lastDigestAsk = Date.now(); this.askSoon(); }
    }
  }

  /** Sends `to` what it lacks (always with everything deleted here). */
  private reply(to: number, sv: Uint8Array) {
    this.out.replies.set(to, Y.encodeStateAsUpdate(this.doc, sv));
    this.schedule();
  }

  // ── Leaving ────────────────────────────────────────────────────────────

  /** Tells the others, at once, that this side is gone. */
  private farewell() {
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'left');
    this.flush();
  }

  // Closing the tab or reloading: the others learn of it now rather than when
  // this side's presence times out, so the next one starts saving at once.
  private readonly onPageHide = () => { if (!this.gone) this.farewell(); };
  private readonly onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || this.gone) return;
    this.describe();
    this.ask();
  };

  private destroy() {
    if (this.gone) return;
    this.farewell();
    this.gone = true;
    if (this.hub.sessions.get(this.noteId) === this) this.hub.sessions.delete(this.noteId);
    clearInterval(this.resyncTimer);
    for (const timer of [this.flushTimer, this.askTimer, this.followTimer]) if (timer) clearTimeout(timer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
      window.removeEventListener('pageshow', this.onPageShow);
    }
    this.detach(this.doc, this.awareness);
    this.releaseWire();
    this.awareness.destroy();
    this.doc.destroy();
  }
}

/** A tab's sessions over `retain` (the app's shared channels; a test's own). */
export function createNoteCollabHub(retain: typeof retainChannel = retainChannel): (noteId: string) => NoteCollab {
  const hub: Hub = { wires: new Map(), sessions: new Map(), retain };
  return (noteId) => {
    let session = hub.sessions.get(noteId);
    if (!session) { session = new Session(hub, noteId); hub.sessions.set(noteId, session); }
    return session.retain();
  };
}

/** This tab's session for a Note, for as long as an editor holds it (release()). */
export const openNoteCollab = createNoteCollabHub();
