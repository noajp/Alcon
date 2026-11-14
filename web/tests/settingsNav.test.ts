/** @vitest-environment jsdom */
//
// The settingsNav store: setActiveSettingsSection is a REVEAL — it names
// the page and bumps a nonce on every call, including re-revealing the
// page already shown. One nav row is one page; nothing switches inside.

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  SETTINGS_ITEMS, SETTINGS_NAV,
  isLonePage,
  setActiveSettingsSection,
  useActiveSettingsSection,
  useSettingsRevealNonce,
} from '@/Function/settings/settingsNav';

function probe() {
  return renderHook(() => ({
    section: useActiveSettingsSection(),
    nonce: useSettingsRevealNonce(),
  }));
}

let current: ReturnType<typeof probe> | null = null;
afterEach(() => { current?.unmount(); current = null; });

describe('settingsNav store', () => {
  it('opens on the first page of the nav, no reveal yet', () => {
    current = probe();
    expect(current.result.current).toEqual({ section: 'preferences', nonce: 0 });
  });

  it('a reveal sets the page and bumps the nonce', () => {
    current = probe();
    const before = current.result.current.nonce;
    act(() => setActiveSettingsSection('connectors'));
    expect(current.result.current).toEqual({ section: 'connectors', nonce: before + 1 });
  });

  it('re-revealing the same page still bumps the nonce (it starts at the top again)', () => {
    current = probe();
    act(() => setActiveSettingsSection('connectors'));
    const before = current.result.current.nonce;
    act(() => setActiveSettingsSection('connectors'));
    expect(current.result.current).toEqual({ section: 'connectors', nonce: before + 1 });
  });

  it('a page the nav does not have opens the first page', () => {
    current = probe();
    act(() => setActiveSettingsSection('integrations'));
    expect(current.result.current.section).toBe('preferences');
  });

  it('the name of a part opens the page that holds it', () => {
    current = probe();
    act(() => setActiveSettingsSection('timeline'));
    expect(current.result.current.section).toBe('strategy');
    act(() => setActiveSettingsSection('initiative'));
    expect(current.result.current.section).toBe('strategy');
  });
});

describe('nav model', () => {
  it('every page id is listed once', () => {
    const ids = SETTINGS_NAV.flatMap((g) => g.items.map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(SETTINGS_ITEMS).sort()).toEqual([...ids].sort());
  });

  it('lists no page without something to set', () => {
    for (const gone of ['phase', 'workload', 'calendar', 'connected']) expect(SETTINGS_ITEMS[gone]).toBeUndefined();
  });

  it('Strategy is one page under its own name, so its row stands without a section label', () => {
    const strategy = SETTINGS_NAV.find((g) => g.title === 'Strategy')!;
    expect(strategy.items.map((i) => i.id)).toEqual(['strategy']);
    expect(isLonePage('Strategy')).toBe(true);
    // A section of several pages, and one whose single page has another name, keep their label.
    expect(isLonePage('Elements')).toBe(false);
    expect(isLonePage('Objects')).toBe(false);
  });
});
