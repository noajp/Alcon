/** @vitest-environment jsdom */
//
// Settings on ONE page (redesign §2/§9): every area renders, stacked in
// nav order on the page ground; stub areas are compact placeholder
// islands; in-area segmented controls swap only their own area's body;
// a reveal lands the named area on the named tab and scrolls to it; the
// scroll-spy moves the store's active section. Panels are stubbed —
// this suite pins the page's composition, not the panels.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { SETTINGS_NAV, setActiveSettingsSection, useActiveSettingsSection } from '@/Function/settings/settingsNav';
import { SettingsView } from '@/Function/settings/SettingsView';

vi.mock('@/Function/settings/ProfileSettings', () => ({ ProfileSettings: () => 'Profile panel' }));
vi.mock('@/Function/settings/AccountSettings', () => ({ AccountSettings: () => 'Account panel' }));
vi.mock('@/Function/settings/TeamSettings', () => ({ TeamSettings: () => 'Team panel' }));
vi.mock('@/Function/settings/ActivitySpaceSettings', () => ({ ActivitySpaceSettings: () => 'Space panel' }));
vi.mock('@/Function/settings/MemberSettings', () => ({ MemberSettings: () => 'Member panel' }));
vi.mock('@/Function/settings/NotificationSettings', () => ({ NotificationSettings: () => 'Notifications panel' }));
vi.mock('@/Function/settings/LabelSettings', () => ({ LabelSettings: () => 'Labels panel' }));
vi.mock('@/Function/settings/ElementTemplateSettings', () => ({ ElementTemplateSettings: () => 'Templates panel' }));
vi.mock('@/Function/settings/StrategySettingsPanels', () => ({
  InitiativeJudgementSettings: () => 'SLA panel',
  PhaseDefaultsSettings: () => 'Phase panel',
}));
vi.mock('@/AIP/connectors/IntegrationsSettings', () => ({
  IntegrationsSettings: ({ tab }: { tab: string | null }) => `Integrations panel: ${tab}`,
}));
vi.mock('@/Function/settings/useUserPreferences', () => ({
  useUserPreferences: () => ({
    preferences: {
      home_view: 'Now', display_names: 'Full name', first_day_of_week: 'Monday',
      convert_emoticons: false, send_comment_shortcut: '⌘+Enter',
    },
    error: null,
    savePreference: vi.fn(),
  }),
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/Function/i18n/LanguageSelect', () => ({ LanguageSelect: () => 'Language select' }));

// ── Browser stand-ins jsdom doesn't provide ──────────────────────────
type EntryLike = { target: Element; isIntersecting: boolean; boundingClientRect: { top: number } };
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: (entries: IntersectionObserverEntry[]) => void;
  constructor(cb: (entries: IntersectionObserverEntry[]) => void) {
    this.callback = cb;
    MockIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  fire(entries: EntryLike[]) {
    this.callback(entries as unknown as IntersectionObserverEntry[]);
  }
}

const scrolled: HTMLElement[] = [];

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  scrolled.length = 0;
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
  HTMLElement.prototype.scrollIntoView = function (this: HTMLElement) { scrolled.push(this); };
});

afterEach(() => { cleanup(); });

const renderPage = () => render(
  <I18nProvider>
    <SettingsView />
  </I18nProvider>,
);

const shell = (c: HTMLElement, id: string) => c.querySelector(`[data-settings-area="${id}"]`) as HTMLElement;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the one page', () => {
  it('renders every area shell in nav order, each headed by its label', () => {
    const view = renderPage();
    const shells = [...view.container.querySelectorAll('[data-settings-area]')];
    const expected = SETTINGS_NAV.flatMap((g) => g.items);
    expect(shells.map((s) => s.getAttribute('data-settings-area'))).toEqual(expected.map((i) => i.id));
    expect(shells.map((s) => s.getAttribute('aria-label'))).toEqual(expected.map((i) => i.label));
  });

  it('renders the real panels and exactly seven compact placeholder islands', () => {
    const view = renderPage();
    for (const text of [
      'Space panel', 'Member panel', 'Integrations panel: definitions', 'Integrations panel: alcon',
      'SLA panel', 'Phase panel', 'Team panel', 'Labels panel',
      'Profile panel', 'Notifications panel', 'Account panel',
    ]) {
      expect(screen.getByText(text), text).toBeTruthy();
    }
    // Objects + Notebook, Table, People, Calendar, Workload, Connected accounts.
    expect(screen.getAllByText(/settings are coming soon\./)).toHaveLength(7);
    // …and the Objects placeholder sits inside a floating island, not loose.
    const objects = shell(view.container, 'objects');
    const island = [...objects.querySelectorAll('div')].find((d) => d.className.includes('--shadow-island'));
    expect(island?.textContent).toContain('settings are coming soon.');
  });

  it('Preferences is headed once — by the area shell, not a panel page title', () => {
    renderPage();
    expect(screen.getAllByRole('heading', { name: 'Preferences' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('General')).toBeTruthy();
  });
});

describe('in-area segmented controls', () => {
  it('swaps only the Elements body, and never scrolls', () => {
    const view = renderPage();
    const elements = shell(view.container, 'elements');
    expect(elements.textContent).toContain('Labels panel');
    const scrollsBefore = scrolled.length;
    fireEvent.click(screen.getByRole('radio', { name: 'Templates' }));
    expect(elements.textContent).toContain('Templates panel');
    expect(elements.textContent).not.toContain('Labels panel');
    // Every other area is untouched, and a body swap is not a reveal.
    expect(shell(view.container, 'integrations').textContent).toContain('Integrations panel: definitions');
    expect(scrolled.length).toBe(scrollsBefore);
  });

  it('swaps the AI body between Harnesses and Connectors', () => {
    const view = renderPage();
    fireEvent.click(screen.getByRole('radio', { name: 'Connectors' }));
    expect(shell(view.container, 'integrations').textContent).toContain('Integrations panel: external');
    expect(shell(view.container, 'access').textContent).toContain('Integrations panel: alcon');
  });
});

describe('reveal and scroll-spy', () => {
  it('a reveal lands the AI area on Connectors and scrolls its shell into view', () => {
    const view = renderPage();
    act(() => setActiveSettingsSection('integrations', 'external'));
    expect(shell(view.container, 'integrations').textContent).toContain('Integrations panel: external');
    expect(scrolled[scrolled.length - 1]).toBe(shell(view.container, 'integrations'));
  });

  it('the SLA pointer row reveals the Strategy area (the thresholds’ one home)', () => {
    const view = renderPage();
    const section = renderHook(() => useActiveSettingsSection());
    const elements = shell(view.container, 'elements');
    expect(elements.textContent).toContain('Risk thresholds');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Strategy settings' }));
    expect(section.result.current).toBe('initiative');
    expect(scrolled[scrolled.length - 1]).toBe(shell(view.container, 'initiative'));
    section.unmount();
  });

  it('the scroll-spy moves the store to the area the reader has reached', async () => {
    const view = renderPage();
    const section = renderHook(() => useActiveSettingsSection());
    // The mount reveal suspends the spy; a scroll + settle lifts it.
    const root = view.container.querySelector('.overflow-y-auto') as HTMLElement;
    fireEvent.scroll(root);
    await sleep(300);
    const members = shell(view.container, 'members');
    const workspace = shell(view.container, 'workspace');
    act(() => {
      MockIntersectionObserver.instances[0].fire([
        { target: workspace, isIntersecting: false, boundingClientRect: { top: -300 } },
        { target: members, isIntersecting: true, boundingClientRect: { top: 40 } },
      ]);
    });
    expect(section.result.current).toBe('members');
    section.unmount();
  });
});
