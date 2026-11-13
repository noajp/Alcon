// The order of the sidebar's fixed rows. Each person drags them into the
// order they want; it is kept in this browser (a convenience, not a
// record). A saved order is read leniently: an unknown row is dropped
// and a row it never knew — one added since — joins at its default place.

export const SIDEBAR_ITEMS = ['inbox', 'ai', 'strategy'] as const;
export type SidebarItem = (typeof SIDEBAR_ITEMS)[number];

const KEY = 'clayware:sidebar-order';

/** Pure. A saved order made whole: known rows once each, missing ones at
 *  their default place. */
export function normalizeSidebarOrder(saved: unknown): SidebarItem[] {
  const known = new Set<string>(SIDEBAR_ITEMS);
  const kept = Array.isArray(saved)
    ? saved.filter((x, i, all): x is SidebarItem => typeof x === 'string' && known.has(x) && all.indexOf(x) === i)
    : [];
  const out = [...kept];
  SIDEBAR_ITEMS.forEach((item, i) => {
    if (out.includes(item)) return;
    // After the nearest default predecessor already placed.
    const before = SIDEBAR_ITEMS.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, item);
  });
  return out;
}

/** Pure. `item` moved to sit before or after `target`. */
export function moveSidebarItem(order: readonly SidebarItem[], item: SidebarItem, target: SidebarItem, place: 'before' | 'after'): SidebarItem[] {
  if (item === target) return [...order];
  const rest = order.filter((x) => x !== item);
  const at = rest.indexOf(target);
  if (at < 0) return [...order];
  rest.splice(place === 'before' ? at : at + 1, 0, item);
  return rest;
}

export function loadSidebarOrder(): SidebarItem[] {
  if (typeof window === 'undefined') return [...SIDEBAR_ITEMS];
  try {
    const raw = window.localStorage.getItem(KEY);
    return normalizeSidebarOrder(raw ? JSON.parse(raw) : null);
  } catch {
    return [...SIDEBAR_ITEMS];
  }
}

export function saveSidebarOrder(order: readonly SidebarItem[]): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(order)); } catch { /* kept for this session only */ }
}
