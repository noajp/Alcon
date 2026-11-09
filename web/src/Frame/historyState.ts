import type { NavigationState } from '@/types/navigation';

/** A screen the shell can return to: a tab's view and where it was inside
 *  that view — the OpenScreen core (openScreen.ts). A tab's Back and
 *  Forward stacks are lists of these, most recent last. In-memory only:
 *  they die with the browser tab, and a reload restores the current
 *  screen with empty stacks. */
export interface ScreenSnapshot {
  view: string;
  navigation: NavigationState;
}

const MAX_BACK_ENTRIES = 50;
// Settings owns its return (settingsReturn in the shell); history never
// records it, in either direction, so the two never double-bookkeep.
const SETTINGS_VIEW = 'settings';

/** The parts of a screen that name a different place: the view plus the
 *  deep selections of the navigation. One-shot requests riding on the
 *  navigation (strategyCreate, landOnTab) are not places, elementReturn is
 *  a return address rather than a place, and in-surface browsing
 *  (noteFolderId / noteSectionId / tableBrowse) stays within one screen —
 *  none of those move the key. */
function routePartsOf(screen: ScreenSnapshot): (string | null)[] {
  const n = screen.navigation;
  return [
    screen.view,
    n.objectId ?? null,
    n.objectDomainId ?? null,
    n.elementId ?? null,
    n.strategyId ?? null,
    n.tableId ?? null,
    n.noteId ?? null,
    n.documentId ?? null,
    n.canvasId ?? null,
    n.codeChangeId ?? null,
    n.workerId ?? null,
    n.unitId ?? null,
    n.homeSelection ? `${n.homeSelection.type}:${n.homeSelection.id}` : null,
    n.audit?.view ?? null,
    n.audit?.deploymentId ?? null,
    n.audit?.tab ?? null,
    n.audit?.runId ?? null,
    n.audit ? String(!!n.audit.attention) : null,
    n.files?.view ?? null,
    n.files?.tab ?? null,
    n.files?.domainId ?? null,
    n.files?.objectId ?? null,
    n.files?.folderId ?? null,
    n.files?.fileId ?? null,
  ];
}

/** Pure. What counts as "a different screen", as one comparable string. */
export function routeKeyOf(screen: ScreenSnapshot): string {
  return JSON.stringify(routePartsOf(screen));
}

/** A retreat only ever lets go: every deep selection is kept or cleared,
 *  none is set to something new, and at least one is actually cleared.
 *  (The view itself may change — an Element detail's Object crumb both
 *  clears the Element and lands on the Objects view.) */
function isRetreat(before: ScreenSnapshot, after: ScreenSnapshot): boolean {
  const b = routePartsOf(before);
  const a = routePartsOf(after);
  let cleared = false;
  for (let i = 1; i < b.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (a[i] === null && b[i] !== null) { cleared = true; continue; }
    return false;
  }
  return cleared;
}

/** Pure. The stack after moving from `before` to `after`:
 *  - Settings is never recorded, in either direction.
 *  - Same route key: nothing to record.
 *  - A retreat that lands exactly on the stack's top consumes that entry
 *    (the close undoes the open that pushed it) instead of pushing.
 *  - Otherwise the screen left is pushed, capped at 50, never duplicating
 *    the current top.
 *  Returns the same array when nothing changed. */
export function recordNavigation(
  stack: readonly ScreenSnapshot[],
  before: ScreenSnapshot,
  after: ScreenSnapshot,
): ScreenSnapshot[] {
  if (before.view === SETTINGS_VIEW || after.view === SETTINGS_VIEW) return [...stack];
  const beforeKey = routeKeyOf(before);
  const afterKey = routeKeyOf(after);
  if (beforeKey === afterKey) return [...stack];
  const top = stack[stack.length - 1];
  if (top && routeKeyOf(top) === afterKey && isRetreat(before, after)) {
    return stack.slice(0, -1);
  }
  if (top && routeKeyOf(top) === beforeKey) return [...stack];
  const next = [...stack, before];
  return next.length > MAX_BACK_ENTRIES ? next.slice(next.length - MAX_BACK_ENTRIES) : next;
}

/** Pure. Take the most recent screen off the stack, or null at the bottom. */
export function popBack(
  stack: readonly ScreenSnapshot[],
): { screen: ScreenSnapshot; stack: ScreenSnapshot[] } | null {
  const top = stack[stack.length - 1];
  if (!top) return null;
  return { screen: top, stack: stack.slice(0, -1) };
}

/** Pure. The Forward stack after a navigation from `before` to `after`:
 *  a fresh navigation — a different route key, Settings excluded; the
 *  moves recordNavigation records — clears it (the browser rule: going
 *  somewhere new kills where Forward could return to). A same-key write
 *  is in-surface browsing and leaves it standing, and the Settings
 *  detour is ignored in both directions, as it is for recording. */
export function forwardAfterNavigation(
  forward: readonly ScreenSnapshot[],
  before: ScreenSnapshot,
  after: ScreenSnapshot,
): ScreenSnapshot[] {
  if (before.view === SETTINGS_VIEW || after.view === SETTINGS_VIEW) return [...forward];
  if (routeKeyOf(before) === routeKeyOf(after)) return [...forward];
  return [];
}

/** One step through a tab's history: the screen to show, and the tab's
 *  two stacks after the step. */
export interface HistoryStep {
  screen: ScreenSnapshot;
  back: ScreenSnapshot[];
  forward: ScreenSnapshot[];
}

/** Pure. One step back from `current`: the most recent Back entry
 *  becomes the screen, and the screen left moves onto the Forward
 *  stack, so stepForward can undo the step. Null at the bottom of the
 *  Back stack — and on Settings, whose own return owns leaving it, so
 *  Settings never lands on either stack. */
export function stepBack(
  current: ScreenSnapshot,
  back: readonly ScreenSnapshot[],
  forward: readonly ScreenSnapshot[],
): HistoryStep | null {
  if (current.view === SETTINGS_VIEW) return null;
  const popped = popBack(back);
  if (!popped) return null;
  return { screen: popped.screen, back: popped.stack, forward: [...forward, current] };
}

/** Pure. One step forward — the mirror of stepBack: the most recent
 *  Forward entry becomes the screen, and the screen left is appended
 *  to the Back stack raw. Not recordNavigation: returning somewhere is
 *  not a fresh navigation, so nothing is consumed, filtered or capped
 *  here. Null at the top of the Forward stack, and on Settings. */
export function stepForward(
  current: ScreenSnapshot,
  back: readonly ScreenSnapshot[],
  forward: readonly ScreenSnapshot[],
): HistoryStep | null {
  if (current.view === SETTINGS_VIEW) return null;
  const popped = popBack(forward);
  if (!popped) return null;
  return { screen: popped.screen, back: [...back, current], forward: popped.stack };
}
