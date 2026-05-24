// localStorage-backed activity log per Element. We append an entry on
// every meaningful change in ElementDetailView (status / priority /
// assignee / due / estimate / title / description / subelement / craft
// check-out) and render the result in the Activity tab.
//
// Until a real element_activity table lands in Supabase, this is the
// pragmatic fallback that keeps the feed populated for the user who
// triggered the change. The shape mirrors what a future server-backed
// table should hold so the swap is mechanical.

export type ActivityKind =
  | 'created'
  | 'renamed'
  | 'description'
  | 'status'
  | 'priority'
  | 'assigned'
  | 'unassigned'
  | 'due'
  | 'estimate'
  | 'subelement'
  | 'craft'
  | 'note'
  | 'comment';

export interface ActivityEntry {
  id: string;
  element_id: string;
  kind: ActivityKind;
  /** Plain-text summary, ready to render. */
  detail: string;
  /** Display name of who did it (or 'System'). */
  author: string;
  created_at: string;
}

const KEY = (elementId: string) => `alcon:activity:${elementId}`;

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

function newId(): string {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadActivity(elementId: string): ActivityEntry[] {
  if (typeof window === 'undefined') return [];
  return safeParse<ActivityEntry[]>(localStorage.getItem(KEY(elementId)), []);
}

export function logActivity(
  elementId: string,
  kind: ActivityKind,
  detail: string,
  author: string = 'You'
): ActivityEntry {
  const entry: ActivityEntry = {
    id: newId(),
    element_id: elementId,
    kind,
    detail,
    author,
    created_at: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    const all = loadActivity(elementId);
    // Cap at 200 entries — anything older falls off the rail.
    const trimmed = [entry, ...all].slice(0, 200);
    localStorage.setItem(KEY(elementId), JSON.stringify(trimmed));
  }
  return entry;
}

export function clearActivity(elementId: string): void {
  if (typeof window !== 'undefined') localStorage.removeItem(KEY(elementId));
}
