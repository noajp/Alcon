/** @vitest-environment jsdom */
//
// The settingsNav store after the one-page redesign (design §2.2/§9):
// setActiveSettingsSection is a REVEAL — same tab validation as the old
// page store, plus a nonce that increments on every reveal, including
// re-revealing the area already in view. The scroll-spy's writer moves
// the section without a reveal. The spy's pick (spySectionAt) is pure
// geometry and pinned directly.

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  SETTINGS_ITEMS,
  setActiveSettingsSection,
  setSettingsSectionInView,
  spySectionAt,
  useActiveSettingsSection,
  useActiveSettingsTab,
  useSettingsRevealNonce,
  type SpyCandidate,
} from '@/Function/settings/settingsNav';

function probe() {
  return renderHook(() => ({
    section: useActiveSettingsSection(),
    tab: useActiveSettingsTab(),
    nonce: useSettingsRevealNonce(),
  }));
}

let current: ReturnType<typeof probe> | null = null;
afterEach(() => { current?.unmount(); current = null; });

describe('settingsNav store', () => {
  it('opens on the first area of the nav, no reveal yet', () => {
    current = probe();
    expect(current.result.current).toEqual({ section: 'workspace', tab: null, nonce: 0 });
  });

  it('a reveal sets section and tab and bumps the nonce', () => {
    current = probe();
    const before = current.result.current.nonce;
    act(() => setActiveSettingsSection('integrations', 'external'));
    expect(current.result.current).toEqual({ section: 'integrations', tab: 'external', nonce: before + 1 });
  });

  it('re-revealing the same area and tab still bumps the nonce (it re-scrolls)', () => {
    current = probe();
    act(() => setActiveSettingsSection('integrations', 'external'));
    const before = current.result.current.nonce;
    act(() => setActiveSettingsSection('integrations', 'external'));
    expect(current.result.current.nonce).toBe(before + 1);
    expect(current.result.current.section).toBe('integrations');
    expect(current.result.current.tab).toBe('external');
  });

  it('tab validation is unchanged: omitted or unknown tab → first tab; tab-less area → null', () => {
    current = probe();
    act(() => setActiveSettingsSection('integrations'));
    expect(current.result.current.tab).toBe('definitions');
    act(() => setActiveSettingsSection('access', 'bogus'));
    expect(current.result.current).toMatchObject({ section: 'access', tab: 'alcon' });
    act(() => setActiveSettingsSection('workspace'));
    expect(current.result.current).toMatchObject({ section: 'workspace', tab: null });
  });

  it('the scroll-spy writer moves the section without a reveal and keeps the tab', () => {
    current = probe();
    act(() => setActiveSettingsSection('integrations', 'external'));
    const nonce = current.result.current.nonce;
    act(() => setSettingsSectionInView('members'));
    expect(current.result.current).toEqual({ section: 'members', tab: 'external', nonce });
    // Same area again, and an unknown area, are both no-ops.
    act(() => setSettingsSectionInView('members'));
    act(() => setSettingsSectionInView('no-such-area'));
    expect(current.result.current).toEqual({ section: 'members', tab: 'external', nonce });
  });
});

describe('nav model after the one-page switch', () => {
  it('Objects has no tab strip (its surfaces are all still to come)', () => {
    expect(SETTINGS_ITEMS.objects.tabs).toBeUndefined();
  });

  it('Elements keeps Labels/Templates; the SLAs tab is gone (one home: Strategy)', () => {
    expect(SETTINGS_ITEMS.elements.tabs?.map((x) => x.id)).toEqual(['labels', 'templates']);
  });

  it('AI and API & access keep their in-area tabs', () => {
    expect(SETTINGS_ITEMS.integrations.tabs?.map((x) => x.id)).toEqual(['definitions', 'external']);
    expect(SETTINGS_ITEMS.access.tabs?.map((x) => x.id)).toEqual(['alcon', 'assets']);
  });
});

describe('spySectionAt', () => {
  const cand = (id: string, top: number, intersecting = true): SpyCandidate => ({ id, top, intersecting });
  const LINE = 96;

  it('keeps the previous area when nothing is visible', () => {
    expect(spySectionAt([cand('a', 0, false), cand('b', 10, false)], LINE, 'a')).toBe('a');
    expect(spySectionAt([], LINE, 'members')).toBe('members');
  });

  it('picks the last visible area whose top has crossed the line', () => {
    expect(spySectionAt([cand('a', -300), cand('b', 40), cand('c', 400)], LINE, 'a')).toBe('b');
    expect(spySectionAt([cand('a', -300), cand('b', -20)], LINE, 'a')).toBe('b');
  });

  it('an area merely peeking into the band does not take over', () => {
    expect(spySectionAt([cand('a', 10), cand('b', 500)], LINE, 'a')).toBe('a');
  });

  it('when no top has crossed yet (title zone), the highest visible area wins', () => {
    expect(spySectionAt([cand('a', 300), cand('b', 500)], LINE, 'workspace')).toBe('a');
  });

  it('non-intersecting shells never win, even with a crossed top', () => {
    expect(spySectionAt([cand('a', 10, false), cand('b', 300)], LINE, 'a')).toBe('b');
  });
});
