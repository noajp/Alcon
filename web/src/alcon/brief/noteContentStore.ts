/** Shared, per-Note drafts and serialized autosaves. Network access stays in the hook. */
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
  listeners: Set<() => void>;
  revision: number;
  savedRevision: number;
  timer: ReturnType<typeof setTimeout> | null;
  read: Promise<void> | null;
  write: Promise<void> | null;
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(error && typeof error === 'object' && 'message' in error
    ? String(error.message) : 'Could not sync this Note.');
}

export function createNoteContentStore(adapter: {
  read: (noteId: string) => Promise<string>;
  write: (noteId: string, html: string) => Promise<void>;
}, delayMs = 500) {
  const entries = new Map<string, Entry>();
  function entryFor(noteId: string): Entry {
    let entry = entries.get(noteId);
    if (!entry) {
      entry = { snapshot: { ...EMPTY_NOTE_CONTENT, loading: true }, listeners: new Set(),
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
    update(entry, { loading: !entry.snapshot.ready, error: null, errorKind: null });
    entry.read = Promise.resolve().then(() => adapter.read(noteId)).then((html) => {
      if (entry.revision === revision) update(entry, { html, ready: true });
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
      while (entry.revision > entry.savedRevision) {
        clearTimer(entry);
        const revision = entry.revision;
        const html = entry.snapshot.html;
        update(entry, { saving: true, error: null, errorKind: null });
        try {
          await adapter.write(noteId, html);
          entry.savedRevision = revision;
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
    });
    return entry.write;
  }

  return {
    getSnapshot: (noteId: string) => entryFor(noteId).snapshot,
    subscribe(noteId: string, listener: () => void) {
      const entry = entryFor(noteId);
      entry.listeners.add(listener);
      return () => { entry.listeners.delete(listener); };
    },
    load,
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
