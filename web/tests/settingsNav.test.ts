/** @vitest-environment jsdom */
//
// The settingsNav store:
// setActiveSettingsSection is a REVEAL — same tab validation as the old
// page store, plus a nonce that increments on every reveal, including
// re-revealing the area already shown.

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  SETTINGS_ITEMS,
  setActiveSettingsSection,
  useActiveSettingsSection,
  useActiveSettingsTab,
  useSettingsRevealNonce,
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
});

describe('nav model', () => {
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
