// "Open this Element's page" from elsewhere (a file found in Files or ⌘K).
// An Element's page is the Object page's own state, not a route, so the
// request waits here: the Object page takes it when it opens, or at once if
// it is already open on that Element's Object.

export const ELEMENT_DETAIL_EVENT = 'clayware:element-detail';
let pending: string | null = null;

export function requestElementDetail(elementId: string): void {
  pending = elementId;
  window.dispatchEvent(new CustomEvent<string>(ELEMENT_DETAIL_EVENT, { detail: elementId }));
}

/** Show the Object's own page: an open Element's page closes. */
export function requestObjectPage(): void {
  pending = null;
  window.dispatchEvent(new CustomEvent<string | null>(ELEMENT_DETAIL_EVENT, { detail: null }));
}

/** The Element waiting to be opened, if any (left in place). */
export const pendingElementDetail = (): string | null => pending;

/** The request is done (opened, or not this Object's). */
export function clearElementDetail(elementId: string): void {
  if (pending === elementId) pending = null;
}
