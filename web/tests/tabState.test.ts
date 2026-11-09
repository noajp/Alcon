import { describe, expect, it } from 'vitest';
import type { AppTab } from '@/Frame/appTab';
import type { ScreenSnapshot } from '@/Frame/historyState';
import {
  closeTab,
  isItemScreen,
  newTab,
  openScreen,
  reorderTabs,
  switchTab,
  type TabListState,
} from '@/Frame/tabState';
import type { NavigationState } from '@/types/navigation';

let minted = 0;
const makeTab = (view = 'inbox', navigation: Partial<NavigationState> = {}): AppTab => ({
  id: `tab-${++minted}`,
  activeView: view,
  navigation: { objectId: null, ...navigation },
  back: [],
  forward: [],
});

const screen = (view: string, navigation: Partial<NavigationState> = {}): ScreenSnapshot => ({
  view,
  navigation: { objectId: null, ...navigation },
});

const stateWith = (...tabs: AppTab[]): TabListState => ({ tabs, activeTabId: tabs[0].id });

describe('what counts as an item screen', () => {
  it('names a thing through its deep selection', () => {
    expect(isItemScreen(screen('objects', { objectId: 'o1' }))).toBe(true);
    expect(isItemScreen(screen('domain-elements', { elementId: 'e1', objectId: 'o1' }))).toBe(true);
    expect(isItemScreen(screen('strategy', { strategyId: 's1' }))).toBe(true);
    expect(isItemScreen(screen('tables', { tableId: 't1' }))).toBe(true);
    expect(isItemScreen(screen('note', { noteId: 'n1' }))).toBe(true);
    expect(isItemScreen(screen('reviews', { codeChangeId: 'c1' }))).toBe(true);
    expect(isItemScreen(screen('audit', { audit: { view: 'workflow', deploymentId: 'w1' } }))).toBe(true);
    expect(isItemScreen(screen('files', { files: { tab: 'space', fileId: 'f1' } }))).toBe(true);
  });

  it('a plain view, a cleared selection and one-shots name nothing', () => {
    expect(isItemScreen(screen('slides'))).toBe(false);
    expect(isItemScreen(screen('objects', { objectId: null }))).toBe(false);
    expect(isItemScreen(screen('strategy', { strategyId: null, strategyCreate: true }))).toBe(false);
    expect(isItemScreen(screen('note', { noteFolderId: 'f1' }))).toBe(false);
    expect(isItemScreen(screen('audit', { audit: { view: 'overview' } }))).toBe(false);
  });
});

describe('opening an item', () => {
  it('creates a fresh tab showing the item and focuses it', () => {
    const home = makeTab('home');
    const next = openScreen(stateWith(home), screen('objects', { objectId: 'o1', objectDomainId: 'd1' }), (s) => makeTab(s.view, s.navigation));
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[0]).toBe(home);
    expect(next.activeTabId).toBe(next.tabs[1].id);
    expect(next.tabs[1].activeView).toBe('objects');
    expect(next.tabs[1].navigation).toEqual({ objectId: 'o1', objectDomainId: 'd1' });
    expect(next.tabs[1].back).toEqual([]);
    expect(next.tabs[1].forward).toEqual([]);
  });

  it('dedups by route key: an item already open is focused, not duplicated', () => {
    const home = makeTab('home');
    const object = makeTab('objects', { objectId: 'o1', objectDomainId: 'd1' });
    const state = stateWith(home, object);
    const next = openScreen(state, screen('objects', { objectId: 'o1', objectDomainId: 'd1' }), (s) => makeTab(s.view, s.navigation));
    expect(next.tabs).toBe(state.tabs);
    expect(next.activeTabId).toBe(object.id);
  });

  it('dedup ignores one-shots riding on the navigation, like route keys do', () => {
    const object = makeTab('objects', { objectId: 'o1', landOnTab: 'elements' });
    const state = stateWith(object);
    const next = openScreen(state, screen('objects', { objectId: 'o1' }), (s) => makeTab(s.view, s.navigation));
    expect(next.tabs).toHaveLength(1);
    expect(next.activeTabId).toBe(object.id);
  });

  it('focusing the tab already showing the item changes nothing', () => {
    const object = makeTab('objects', { objectId: 'o1' });
    const state = stateWith(object);
    expect(openScreen(state, screen('objects', { objectId: 'o1' }), (s) => makeTab(s.view, s.navigation))).toBe(state);
  });

  it('an item opened from an item leaves the source tab untouched', () => {
    const object = makeTab('objects', { objectId: 'o1' });
    object.back = [screen('home')];
    const state = { tabs: [object], activeTabId: object.id };
    const next = openScreen(state, screen('strategy', { strategyId: 's1' }), (s) => makeTab(s.view, s.navigation));
    expect(next.tabs[0]).toBe(object);
    expect(object.activeView).toBe('objects');
    expect(object.back).toHaveLength(1);
    expect(next.activeTabId).toBe(next.tabs[1].id);
  });

  it('a different item on the same view is a different tab', () => {
    const first = makeTab('objects', { objectId: 'o1' });
    const state = stateWith(first);
    const next = openScreen(state, screen('objects', { objectId: 'o2' }), (s) => makeTab(s.view, s.navigation));
    expect(next.tabs).toHaveLength(2);
  });

  it('Settings is never a tab', () => {
    const state = stateWith(makeTab('home'));
    expect(openScreen(state, screen('settings'), (s) => makeTab(s.view, s.navigation))).toBe(state);
  });
});

describe('switching tabs', () => {
  it('changes only which tab is active', () => {
    const a = makeTab('home');
    const b = makeTab('objects', { objectId: 'o1' });
    b.back = [screen('home')];
    const state = stateWith(a, b);
    const next = switchTab(state, b.id);
    expect(next.activeTabId).toBe(b.id);
    expect(next.tabs).toBe(state.tabs);
    expect(b.back).toHaveLength(1);
  });

  it('an unknown or already-active tab changes nothing', () => {
    const state = stateWith(makeTab('home'));
    expect(switchTab(state, 'nope')).toBe(state);
    expect(switchTab(state, state.activeTabId)).toBe(state);
  });
});

describe('closing tabs', () => {
  it('closing an inactive tab leaves the active one alone', () => {
    const a = makeTab('home');
    const b = makeTab('objects', { objectId: 'o1' });
    const next = closeTab(stateWith(a, b), b.id, () => makeTab('home'));
    expect(next.tabs).toEqual([a]);
    expect(next.activeTabId).toBe(a.id);
  });

  it('closing the active tab focuses its right neighbour', () => {
    const a = makeTab('home');
    const b = makeTab('objects', { objectId: 'o1' });
    const c = makeTab('strategy', { strategyId: 's1' });
    const state = { tabs: [a, b, c], activeTabId: b.id };
    const next = closeTab(state, b.id, () => makeTab('home'));
    expect(next.tabs).toEqual([a, c]);
    expect(next.activeTabId).toBe(c.id);
  });

  it('closing the active last tab focuses its left neighbour', () => {
    const a = makeTab('home');
    const b = makeTab('objects', { objectId: 'o1' });
    const state = { tabs: [a, b], activeTabId: b.id };
    const next = closeTab(state, b.id, () => makeTab('home'));
    expect(next.tabs).toEqual([a]);
    expect(next.activeTabId).toBe(a.id);
  });

  it('closing the only tab replaces it with a fresh home tab', () => {
    const only = makeTab('objects', { objectId: 'o1' });
    const next = closeTab(stateWith(only), only.id, () => makeTab('home'));
    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].id).not.toBe(only.id);
    expect(next.tabs[0].activeView).toBe('home');
    expect(next.activeTabId).toBe(next.tabs[0].id);
  });

  it('closing a tab that does not exist changes nothing', () => {
    const state = stateWith(makeTab('home'));
    expect(closeTab(state, 'nope', () => makeTab('home'))).toBe(state);
  });
});

describe('new tabs', () => {
  it('appends a tab at the home view and focuses it', () => {
    const a = makeTab('objects', { objectId: 'o1' });
    const next = newTab(stateWith(a), () => makeTab('home'));
    expect(next.tabs).toHaveLength(2);
    expect(next.tabs[1].activeView).toBe('home');
    expect(next.activeTabId).toBe(next.tabs[1].id);
  });
});

describe('reordering tabs', () => {
  it('follows the given order and keeps the active tab active', () => {
    const a = makeTab('home');
    const b = makeTab('objects', { objectId: 'o1' });
    const c = makeTab('strategy', { strategyId: 's1' });
    const state = { tabs: [a, b, c], activeTabId: b.id };
    const next = reorderTabs(state, [c.id, a.id, b.id]);
    expect(next.tabs).toEqual([c, a, b]);
    expect(next.activeTabId).toBe(b.id);
  });

  it('a stale order cannot lose a tab', () => {
    const a = makeTab('home');
    const b = makeTab('objects', { objectId: 'o1' });
    const next = reorderTabs(stateWith(a, b), [b.id, 'gone']);
    expect(next.tabs).toEqual([b, a]);
  });
});
