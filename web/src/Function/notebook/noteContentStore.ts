import { mergeNote } from './noteMerge';

/** Shared, per-Note drafts and serialized autosaves. Network access stays in the hook.
 *
 * Several people can edit one Note. Each body is remembered with the version
 * (the row's updated_at) it was read at, and a save lands only on that
 * version. When someone else saved first, their body is read and the two
 * are merged paragraph by paragraph (noteMerge) over the body both started
 * from, then saved again. A body that arrives live (Realtime) is taken as it
 * is when nothing here is unsaved, and merged into the draft when something
 * is; one that arrives during a save is looked at again once the save is
 * done, since the save itself may be what replaced it. */
interface NoteContentSnapshot {
  html: string;
  ready: boolean;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
  error: Error | null;
  errorKind: 'read' | 'write' | null;
}

export const EMPTY_NOTE_CONTENT: NoteContentSnapshot = {
  html: '', ready: false, loading: false, saving: false, dirty: false, error: null, errorKind: null,
};

interface Entry {
  snapshot: NoteContentSnapshot;
  /** The server's body as last read or written, and its version: what this
   *  side's draft started from. */
  base: string;
  stamp: string | null;
  /** A live change that came in while a save was running. */
  missed: boolean;
  listeners: Set<() => void>;
  revision: number;
  savedRevision: number;
  timer: ReturnType<typeof setTimeout> | null;
  read: Promise<void> | null;
  write: Promise<void> | null;
}

/** Postgres and Realtime spell a timestamp differently; compare what they mean. */
function sameStamp(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) => s.replace(' ', 'T').replace(/(Z|\+00(:?00)?)$/, '');
  return norm(a) === norm(b);
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(error && typeof error === 'object' && 'message' in error
    ? String(error.message) : 'Could not sync this Note.');
}

export interface NoteBody { html: string; stamp: string | null }

export function createNoteContentStore(adapter: {
  read: (noteId: string) => Promise<NoteBody>;
  /** Saves over version `stamp` (null: there is no row yet). 'conflict' when
   *  the server holds another version. */
  write: (noteId: string, html: string, stamp: string | null) => Promise<{ stamp: string } | 'conflict'>;
}, delayMs = 500) {
  const entries = new Map<string, Entry>();
  function entryFor(noteId: string): Entry {
    let entry = entries.get(noteId);
    if (!entry) {
      entry = { snapshot: { ...EMPTY_NOTE_CONTENT, loading: true }, listeners: new Set(),
        base: '', stamp: null, missed: false,
        revision: 0, savedRevision: 0, timer: null, read: null, write: null };
      entries.set(noteId, entry);
    }
    return entry;
  }
  function update(entry: Entry, patch: Partial<NoteContentSnapshot>) {
    entry.snapshot = { ...entry.snapshot, ...patch };
    entry.listeners.forEach((listener) => listener());
  }
  function clearTimer(entry: Entry) {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  }

  async function load(noteId: string): Promise<void> {
    const entry = entryFor(noteId);
    // A failed or pending draft is authoritative until explicitly saved. A
    // remount must not replace it with the server's older body.
    if (entry.read) return entry.read;
    if (entry.snapshot.dirty || entry.write) return;
    const revision = entry.revision;
    // Revalidation must not unmount another active editor or tear down its
    // IME composition. Controlled editors reconcile the fresh body in place.
    update(entry, { loading: !entry.snapshot.ready, error: null, errorKind: null });
    entry.read = Promise.resolve().then(() => adapter.read(noteId)).then((body) => {
      if (entry.revision !== revision) return;
      entry.base = body.html;
      entry.stamp = body.stamp;
      update(entry, { html: body.html, ready: true });
    }).catch((error: unknown) => {
      if (entry.revision === revision) update(entry, { error: asError(error), errorKind: 'read' });
    }).finally(() => {
      entry.read = null;
      update(entry, { loading: false });
    });
    return entry.read;
  }

  function flush(noteId: string): Promise<void> {
    const entry = entryFor(noteId);
    clearTimer(entry);
    if (entry.write) return entry.write;
    if (!entry.snapshot.dirty) return Promise.resolve();
    // Assign the Promise before starting the adapter so simultaneous consumers
    // join one drain. While a write runs, edits coalesce into the latest draft.
    entry.write = Promise.resolve().then(async () => {
      let conflicts = 0;
      while (entry.revision > entry.savedRevision) {
        clearTimer(entry);
        const revision = entry.revision;
        const html = entry.snapshot.html;
        update(entry, { saving: true, error: null, errorKind: null });
        try {
          const saved = await adapter.write(noteId, html, entry.stamp);
          if (saved === 'conflict') {
            // Someone else saved first: put both together and try again.
            if (++conflicts > 5) throw new Error('This Note keeps changing. Try again in a moment.');
            const theirs = await adapter.read(noteId);
            const merged = mergeNote(entry.base, entry.snapshot.html, theirs.html);
            entry.base = theirs.html;
            entry.stamp = theirs.stamp;
            if (merged === theirs.html) {
              // Everything here was already there: nothing left to save.
              entry.savedRevision = entry.revision;
              update(entry, { html: merged, dirty: false });
            } else if (merged !== entry.snapshot.html) {
              entry.revision += 1;
              update(entry, { html: merged });
            }
            continue;
          }
          entry.savedRevision = revision;
          entry.base = html;
          entry.stamp = saved.stamp;
          update(entry, { dirty: entry.revision > revision });
        } catch (error) {
          // Keep the newest draft, including edits made during this failed
          // write. Errors are state, so cleanup can flush without an unhandled
          // rejection and the next mount can offer Retry.
          clearTimer(entry);
          update(entry, { error: asError(error), errorKind: 'write', dirty: true });
          return;
        }
      }
    }).finally(() => {
      entry.write = null;
      update(entry, { saving: false });
      // A change that arrived mid-save may be newer than ours: read it again.
      if (entry.missed) {
        entry.missed = false;
        void adapter.read(noteId).then((body) => receive(noteId, body)).catch(() => {});
      }
    });
    return entry.write;
  }

  /** A body someone saved (live, or read back after a save). */
  function receive(noteId: string, body: NoteBody) {
    const entry = entries.get(noteId);
    if (!entry || !entry.snapshot.ready || sameStamp(body.stamp, entry.stamp)) return;
    if (entry.write) { entry.missed = true; return; }
    const html = entry.snapshot.dirty ? mergeNote(entry.base, entry.snapshot.html, body.html) : body.html;
    entry.base = body.html;
    entry.stamp = body.stamp;
    if (html !== entry.snapshot.html) update(entry, { html });
  }

  return {
    getSnapshot: (noteId: string) => entryFor(noteId).snapshot,
    subscribe(noteId: string, listener: () => void) {
      const entry = entryFor(noteId);
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); };
    },
    load,
    receive,
    edit(noteId: string, html: string) {
      const entry = entryFor(noteId);
      if (html === entry.snapshot.html) return;
      entry.revision += 1;
      update(entry, { html, ready: true, loading: false, dirty: true, error: null, errorKind: null });
      clearTimer(entry);
      entry.timer = setTimeout(() => { void flush(noteId); }, delayMs);
    },
    flush,
    retry(noteId: string) {
      return entryFor(noteId).snapshot.dirty ? flush(noteId) : load(noteId);
    },
  };
}
