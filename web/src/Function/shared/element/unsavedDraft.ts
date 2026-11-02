// What was typed into an Element's title or description but did not save
// (offline, refused). Kept in this browser per Element so it can be put back
// and saved again the next time the Element is opened, instead of vanishing
// when the failed write is rolled back.

export type UnsavedElementDraft = { title?: string; description?: string };
type Field = keyof UnsavedElementDraft;

const PREFIX = 'alcon:element-unsaved-draft:';

const unsavedDraftKey = (elementId: string) => `${PREFIX}${elementId}`;

/** A stored draft, or null for anything that is not one. */
export function parseUnsavedDraft(raw: string | null): UnsavedElementDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const { title, description } = value as Record<string, unknown>;
    const draft: UnsavedElementDraft = {};
    if (typeof title === 'string') draft.title = title;
    if (typeof description === 'string') draft.description = description;
    return Object.keys(draft).length ? draft : null;
  } catch {
    return null;
  }
}

/** The fields of a draft that still differ from what is saved. */
export function pendingDraft(
  draft: UnsavedElementDraft | null,
  saved: { title: string; description: string },
): UnsavedElementDraft | null {
  if (!draft) return null;
  const pending: UnsavedElementDraft = {};
  if (draft.title !== undefined && draft.title.trim() && draft.title.trim() !== saved.title) pending.title = draft.title;
  if (draft.description !== undefined && draft.description !== saved.description) pending.description = draft.description;
  return Object.keys(pending).length ? pending : null;
}

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function readUnsavedDraft(elementId: string): UnsavedElementDraft | null {
  try { return parseUnsavedDraft(storage()?.getItem(unsavedDraftKey(elementId)) ?? null); } catch { return null; }
}

export function stashUnsavedDraft(elementId: string, fields: UnsavedElementDraft): void {
  try {
    storage()?.setItem(unsavedDraftKey(elementId), JSON.stringify({ ...readUnsavedDraft(elementId), ...fields }));
  } catch { /* storage full or blocked: the notice still tells the person */ }
}

/** Forget fields once they are saved (all of them when none are named). */
export function clearUnsavedDraft(elementId: string, fields?: Field[]): void {
  try {
    const store = storage();
    if (!store) return;
    const rest = { ...readUnsavedDraft(elementId) };
    for (const field of fields ?? (['title', 'description'] as Field[])) delete rest[field];
    if (Object.keys(rest).length) store.setItem(unsavedDraftKey(elementId), JSON.stringify(rest));
    else store.removeItem(unsavedDraftKey(elementId));
  } catch { /* nothing to forget */ }
}
