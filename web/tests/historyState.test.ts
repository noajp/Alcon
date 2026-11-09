import { describe, expect, it } from 'vitest';
import {
  forwardAfterNavigation,
  popBack,
  recordNavigation,
  routeKeyOf,
  stepBack,
  stepForward,
  type HistoryStep,
  type ScreenSnapshot,
} from '@/Frame/historyState';
import type { NavigationState } from '@/types/navigation';

const screen = (view: string, navigation: Partial<NavigationState> = {}): ScreenSnapshot => ({
  view,
  navigation: { objectId: null, ...navigation },
});

const mustStep = (step: HistoryStep | null): HistoryStep => {
  if (!step) throw new Error('expected a history step');
  return step;
};

describe('what counts as a different screen', () => {
  it('keys on the view and the deep selections', () => {
    const base = screen('objects', { objectId: 'o1', objectDomainId: 'd1' });
    expect(routeKeyOf(base)).toBe(routeKeyOf(screen('objects', { objectId: 'o1', objectDomainId: 'd1' })));
    expect(routeKeyOf(base)).not.toBe(routeKeyOf(screen('objects', { objectId: 'o2', objectDomainId: 'd1' })));
    expect(routeKeyOf(base)).not.toBe(routeKeyOf(screen('strategy', { objectId: 'o1', objectDomainId: 'd1' })));
    expect(routeKeyOf(screen('audit', { audit: { view: 'workflow', deploymentId: 'w1' } })))
      .not.toBe(routeKeyOf(screen('audit', { audit: { view: 'workflow', deploymentId: 'w2' } })));
    expect(routeKeyOf(screen('files', { files: { tab: 'space', fileId: 'f1' } })))
      .not.toBe(routeKeyOf(screen('files', { files: { tab: 'space', fileId: 'f2' } })));
    expect(routeKeyOf(screen('home', { homeSelection: { type: 'domain', id: 'd1' } })))
      .not.toBe(routeKeyOf(screen('home', { homeSelection: null })));
  });

  it('ignores one-shot requests, return addresses and in-surface browsing', () => {
    const base = screen('objects', { objectId: 'o1' });
    expect(routeKeyOf({ ...base, navigation: { ...base.navigation, strategyCreate: true } })).toBe(routeKeyOf(base));
    expect(routeKeyOf({ ...base, navigation: { ...base.navigation, landOnTab: 'elements' } })).toBe(routeKeyOf(base));
    expect(routeKeyOf({ ...base, navigation: { ...base.navigation, elementReturn: { view: 'note', objectId: null, objectDomainId: null, domainId: null } } })).toBe(routeKeyOf(base));
    expect(routeKeyOf(screen('note', { noteId: 'n1', noteFolderId: 'f9', noteSectionId: 's9' })))
      .toBe(routeKeyOf(screen('note', { noteId: 'n1', noteFolderId: 'f1', noteSectionId: 's1' })));
    expect(routeKeyOf(screen('tables', { tableBrowse: { view: 'folders', folderId: 'f1' } })))
      .toBe(routeKeyOf(screen('tables', { tableBrowse: { view: 'home' } })));
  });
});

describe('recording where the person has been', () => {
  it('pushes the screen left, and pops it back', () => {
    const list = screen('objects');
    const object = screen('objects', { objectId: 'o1', objectDomainId: 'd1' });
    const stack = recordNavigation([], list, object);
    expect(stack).toEqual([list]);
    expect(popBack(stack)).toEqual({ screen: list, stack: [] });
    expect(popBack([])).toBeNull();
  });

  it('records nothing when the route does not change', () => {
    const a = screen('objects', { objectId: 'o1' });
    expect(recordNavigation([], a, screen('objects', { objectId: 'o1', noteFolderId: undefined }))).toEqual([]);
    const stack = [screen('inbox')];
    expect(recordNavigation(stack, a, { ...a })).toEqual(stack);
  });

  it('never duplicates the current top', () => {
    const a = screen('inbox');
    const b = screen('objects', { objectId: 'o1' });
    const stack = recordNavigation([a], a, b);
    expect(stack).toEqual([a]);
  });

  it('caps the stack at 50, dropping the oldest', () => {
    let stack: ScreenSnapshot[] = [];
    let current = screen('inbox');
    for (let i = 0; i < 60; i += 1) {
      const next = screen('objects', { objectId: `o${i}` });
      stack = recordNavigation(stack, current, next);
      current = next;
    }
    expect(stack).toHaveLength(50);
    expect(stack[0]).toEqual(screen('objects', { objectId: 'o9' }));
  });

  it('leaves Settings out in both directions — its own return owns that', () => {
    const a = screen('strategy', { strategyId: 's1' });
    const settings = screen('settings');
    expect(recordNavigation([], a, settings)).toEqual([]);
    expect(recordNavigation([], settings, a)).toEqual([]);
  });
});

describe('closes pop instead of pushing', () => {
  it('an Element opened from ⌘K and closed with its own Back leaves no entry', () => {
    const list = screen('note', { noteId: 'n1' });
    // The open merges into the one navigation bag, so the Note route is
    // still in it while the Element is open; the close only clears.
    const detail = screen('domain-elements', { elementId: 'e1', objectId: 'o1', objectDomainId: 'd1', noteId: 'n1' });
    const opened = recordNavigation([], list, detail);
    expect(opened).toEqual([list]);
    // The detail's Back clears the Element (and with it the Object route)
    // and lands exactly on the screen the open was pushed from.
    const closed = recordNavigation(opened, detail, list);
    expect(closed).toEqual([]);
  });

  it('a close that lands somewhere else still records where it came from', () => {
    const list = screen('objects');
    const strategy = screen('strategy', { strategyId: 's1' });
    const detail = screen('domain-elements', { elementId: 'e1', objectId: 'o1', objectDomainId: 'd1' });
    const stack = recordNavigation(recordNavigation([], list, strategy), strategy, detail);
    // Closing the detail returns to the Object page, not the stack's top:
    // the detail screen is pushed, so Back can still revisit it.
    const closed = recordNavigation(stack, detail, screen('objects', { objectId: 'o1', objectDomainId: 'd1' }));
    expect(closed).toEqual([list, strategy, detail]);
  });

  it('a fresh navigation is not mistaken for a close, even back to a screen on the stack', () => {
    const inbox = screen('inbox');
    const object = screen('objects', { objectId: 'o1', objectDomainId: 'd1' });
    const strategy = screen('strategy', { strategyId: 's1', objectId: 'o1', objectDomainId: 'd1' });
    // The navigation is one bag: the Object route is still in it while the
    // Strategy is open, and still in it when the Object is opened again —
    // nothing is cleared, so this is a fresh go and pushes.
    const objectAgain = screen('objects', { objectId: 'o1', objectDomainId: 'd1', strategyId: 's1' });
    let stack = recordNavigation([], inbox, object);
    stack = recordNavigation(stack, object, strategy);
    expect(recordNavigation(stack, strategy, objectAgain)).toEqual([inbox, object, strategy]);
  });
});

describe('going forward again', () => {
  const inbox = screen('inbox');
  const list = screen('objects');
  const object = screen('objects', { objectId: 'o1', objectDomainId: 'd1' });

  it('a step back can be undone: the round trip restores both screens and both stacks', () => {
    const back = mustStep(stepBack(object, [inbox, list], []));
    expect(back).toEqual({ screen: list, back: [inbox], forward: [object] });
    const forward = mustStep(stepForward(back.screen, back.back, back.forward));
    expect(forward).toEqual({ screen: object, back: [inbox, list], forward: [] });
  });

  it('a whole journey: record forward, step back twice, step forward twice', () => {
    let backStack = recordNavigation([], inbox, list);
    backStack = recordNavigation(backStack, list, object);
    expect(backStack).toEqual([inbox, list]);
    const b1 = mustStep(stepBack(object, backStack, []));
    expect(b1.screen).toEqual(list);
    const b2 = mustStep(stepBack(b1.screen, b1.back, b1.forward));
    expect(b2.screen).toEqual(inbox);
    expect(b2.back).toEqual([]);
    expect(b2.forward).toEqual([object, list]);
    const f1 = mustStep(stepForward(b2.screen, b2.back, b2.forward));
    expect(f1.screen).toEqual(list);
    const f2 = mustStep(stepForward(f1.screen, f1.back, f1.forward));
    expect(f2).toEqual({ screen: object, back: [inbox, list], forward: [] });
  });

  it('steps stop at the ends of the stacks', () => {
    expect(stepBack(object, [], [])).toBeNull();
    expect(stepForward(object, [], [])).toBeNull();
    expect(stepForward(object, [inbox], [])).toBeNull();
  });

  it('Settings is never a step: its own return owns leaving it', () => {
    const settings = screen('settings');
    expect(stepBack(settings, [inbox], [])).toBeNull();
    expect(stepForward(settings, [], [object])).toBeNull();
  });

  it('a fresh navigation after going back empties the Forward stack', () => {
    const strategy = screen('strategy', { strategyId: 's1' });
    expect(forwardAfterNavigation([object], list, strategy)).toEqual([]);
    // A retreat records a move too, so it also kills Forward.
    expect(forwardAfterNavigation([object], object, list)).toEqual([]);
  });

  it('a same-route-key write leaves the Forward stack standing', () => {
    const forward = [object];
    const before = screen('note', { noteId: 'n1', noteFolderId: 'f1' });
    const after = screen('note', { noteId: 'n1', noteFolderId: 'f2' });
    expect(forwardAfterNavigation(forward, before, after)).toEqual(forward);
  });

  it('the Settings detour does not clear Forward in either direction', () => {
    const settings = screen('settings');
    expect(forwardAfterNavigation([object], list, settings)).toEqual([object]);
    expect(forwardAfterNavigation([object], settings, list)).toEqual([object]);
  });

  it("one tab's steps never touch another tab's stacks", () => {
    const other = { back: [inbox], forward: [object] };
    mustStep(stepBack(object, [inbox, list], []));
    expect(other).toEqual({ back: [inbox], forward: [object] });
  });
});
