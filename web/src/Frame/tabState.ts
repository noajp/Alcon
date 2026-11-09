import type { AppTab } from '@/Frame/appTab';
import { routeKeyOf, type ScreenSnapshot } from '@/Frame/historyState';

// The shell's tab list as pure transitions over (tabs, activeTabId) —
// the strip and the page's handlers are thin wrappers over these, the
// same division historyState.ts keeps for one tab's stacks. A tab is an
// AppTab: the unit the shell already keeps mounted; tabs differ only by
// the screens they have visited, and each tab's history lives inside it.

export interface TabListState {
  tabs: AppTab[];
  activeTabId: string;
}

/** The screen a tab is currently showing, as history sees it. */
function screenOfTab(tab: AppTab): ScreenSnapshot {
  return { view: tab.activeView, navigation: tab.navigation };
}

// Settings owns its return and opens in place over the active tab; it is
// never a tab and never in history (historyState.ts keeps it off both
// stacks for the same reason).
const SETTINGS_VIEW = 'settings';

/** Pure. Does this screen name a thing — a deep selection an item open
 *  carries (an Object, Element, Strategy, Table, Note, Review, or an
 *  Audit/Files drill-in)? Item opens get a tab of their own; a screen
 *  with no deep selection is a plain view switch and reuses the active
 *  tab. One-shot requests (strategyCreate, landOnTab) and in-surface
 *  browsing (noteFolderId, tableBrowse) name no thing, as in routeKeyOf. */
export function isItemScreen(screen: ScreenSnapshot): boolean {
  const n = screen.navigation;
  return Boolean(
    n.objectId
    || n.elementId
    || n.strategyId
    || n.tableId
    || n.noteId
    || n.documentId
    || n.canvasId
    || n.codeChangeId
    || n.audit?.deploymentId
    || n.audit?.runId
    || n.files?.fileId
    || n.files?.folderId,
  );
}

/** Pure. Open an item screen: if a tab already shows it (same route
 *  key), focus that tab — nothing is recorded anywhere, the person was
 *  already looking at it there. Otherwise append a fresh tab showing it
 *  and focus it; the tab the item was opened from keeps its screen and
 *  its history untouched. Settings is never a tab: the state is
 *  returned unchanged. */
export function openScreen(
  state: TabListState,
  screen: ScreenSnapshot,
  makeTab: (screen: ScreenSnapshot) => AppTab,
): TabListState {
  if (screen.view === SETTINGS_VIEW) return state;
  const key = routeKeyOf(screen);
  const existing = state.tabs.find((tab) => routeKeyOf(screenOfTab(tab)) === key);
  if (existing) return existing.id === state.activeTabId ? state : { ...state, activeTabId: existing.id };
  const tab = makeTab(screen);
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

/** Pure. Show another tab. Nothing else moves: each tab's MainContent
 *  stays mounted, so its state (scroll, drafts, selections) survives the
 *  swap, and no tab's stacks are touched. */
export function switchTab(state: TabListState, tabId: string): TabListState {
  if (tabId === state.activeTabId || !state.tabs.some((tab) => tab.id === tabId)) return state;
  return { ...state, activeTabId: tabId };
}

/** Pure. Close a tab; its stacks and mounted tree go with it (no
 *  recently-closed list). Closing the active tab focuses the right
 *  neighbour, else the left (browser convention). Closing the last tab
 *  replaces it with a fresh home tab, keeping the shell's invariant
 *  that a tab always exists. */
export function closeTab(
  state: TabListState,
  tabId: string,
  makeHomeTab: () => AppTab,
): TabListState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return state;
  const remaining = state.tabs.filter((tab) => tab.id !== tabId);
  if (remaining.length === 0) {
    const home = makeHomeTab();
    return { tabs: [home], activeTabId: home.id };
  }
  if (state.activeTabId !== tabId) return { tabs: remaining, activeTabId: state.activeTabId };
  const neighbour = remaining[index] ?? remaining[index - 1];
  return { tabs: remaining, activeTabId: neighbour.id };
}

/** Pure. A blank tab at the home view, appended and focused — the
 *  strip's "+" and the palette's "New tab". */
export function newTab(state: TabListState, makeTab: () => AppTab): TabListState {
  const tab = makeTab();
  return { tabs: [...state.tabs, tab], activeTabId: tab.id };
}

/** Pure. Reorder the list to `orderedIds` (the strip's drag). Only the
 *  array order changes — the active tab stays active. Ids the list does
 *  not know are ignored; tabs missing from `orderedIds` keep their
 *  relative order at the end, so a stale drag can never lose a tab. */
export function reorderTabs(state: TabListState, orderedIds: readonly string[]): TabListState {
  const byId = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const ordered: AppTab[] = [];
  for (const id of orderedIds) {
    const tab = byId.get(id);
    if (tab) { ordered.push(tab); byId.delete(id); }
  }
  for (const tab of state.tabs) if (byId.has(tab.id)) ordered.push(tab);
  return { ...state, tabs: ordered };
}
