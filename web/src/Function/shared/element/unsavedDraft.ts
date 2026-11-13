// What someone typed into an Element's title or description but did not save
// (offline, timed out). Kept in this browser per signed-in user and Element,
// so the same person can put it back and save it again the next time they
// open the Element, instead of it vanishing when the failed write is rolled
// back. Only the signed-in user's drafts stay on the device: whenever the
// user changes (sign-out, session expiry, another account), everyone else's
// are dropped, as the persisted query cache is — on a shared machine nobody
// sees, or saves under their own name, the previous person's text.

type Field = 'title' | 'description';

/** Per field: the text that did not save, and the saved text it was written over. */
export type UnsavedElementDraft = {
  title?: string;
  description?: string;
  baseTitle?: string;
  baseDescription?: string;
};

/** What to offer back: the fields that still differ from what is saved, and
 *  whether what is saved changed after the draft was written (someone else's
 *  edit that putting the draft back would overwrite). */
export type OfferedDraft = { title?: string; description?: string; changedSince: boolean };

const PREFIX = 'clayware:element-unsaved-draft:';

const unsavedDraftKey = (userId: string, elementId: string) => `${PREFIX}${userId}:${elementId}`;

/** The stored keys among `keys` that must not survive for `userId` (null =
 *  nobody is signed in): every draft but that user's own. */
export function unsavedDraftKeysToDrop(keys: readonly string[], userId: string | null): string[] {
  const keep = userId ? `${PREFIX}${userId}:` : null;
  return keys.filter((k) => k.startsWith(PREFIX) && !(keep && k.startsWith(keep)));
}

/** A stored draft, or null for anything that is not one. */
export function parseUnsavedDraft(raw: string | null): UnsavedElementDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const draft: UnsavedElementDraft = {};
    for (const key of ['title', 'description', 'baseTitle', 'baseDescription'] as const) {
      if (typeof record[key] === 'string') draft[key] = record[key];
    }
    return draft.title !== undefined || draft.description !== undefined ? draft : null;
  } catch {
    return null;
  }
}

export function pendingDraft(
  draft: UnsavedElementDraft | null,
  saved: { title: string; description: string },
): OfferedDraft | null {
  if (!draft) return null;
  const offered: OfferedDraft = { changedSince: false };
  if (draft.title !== undefined && draft.title.trim() && draft.title.trim() !== saved.title) {
    offered.title = draft.title;
    if (draft.baseTitle !== undefined && draft.baseTitle !== saved.title) offered.changedSince = true;
  }
  if (draft.description !== undefined && draft.description !== saved.description) {
    offered.description = draft.description;
    if (draft.baseDescription !== undefined && draft.baseDescription !== saved.description) offered.changedSince = true;
  }
  return offered.title !== undefined || offered.description !== undefined ? offered : null;
}

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function readUnsavedDraft(userId: string | null | undefined, elementId: string): UnsavedElementDraft | null {
  if (!userId) return null;
  try { return parseUnsavedDraft(storage()?.getItem(unsavedDraftKey(userId, elementId)) ?? null); } catch { return null; }
}

/** Keep `text` for `field`, written over the saved `base`. */
export function stashUnsavedDraft(
  userId: string | null | undefined,
  elementId: string,
  field: Field,
  text: string,
  base: string,
): void {
  if (!userId) return;
  const baseKey = field === 'title' ? 'baseTitle' : 'baseDescription';
  try {
    storage()?.setItem(unsavedDraftKey(userId, elementId),
      JSON.stringify({ ...readUnsavedDraft(userId, elementId), [field]: text, [baseKey]: base }));
  } catch { /* storage full or blocked: the notice still tells the person */ }
}

/** Forget fields once they are saved (all of them when none are named). */
export function clearUnsavedDraft(userId: string | null | undefined, elementId: string, fields?: Field[]): void {
  if (!userId) return;
  try {
    const store = storage();
    if (!store) return;
    const rest = { ...readUnsavedDraft(userId, elementId) };
    for (const field of fields ?? (['title', 'description'] as Field[])) {
      delete rest[field];
      delete rest[field === 'title' ? 'baseTitle' : 'baseDescription'];
    }
    if (rest.title !== undefined || rest.description !== undefined) store.setItem(unsavedDraftKey(userId, elementId), JSON.stringify(rest));
    else store.removeItem(unsavedDraftKey(userId, elementId));
  } catch { /* nothing to forget */ }
}

/** Drop every other user's drafts — call whenever the signed-in user changes. */
export function dropOtherUnsavedDrafts(userId: string | null): void {
  try {
    const store = storage();
    if (!store) return;
    const keys = Array.from({ length: store.length }, (_, i) => store.key(i)).filter((k): k is string => k !== null);
    for (const key of unsavedDraftKeysToDrop(keys, userId)) store.removeItem(key);
  } catch { /* best effort */ }
}
