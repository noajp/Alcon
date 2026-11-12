/** @vitest-environment jsdom */
//
// Settings, one area per page: the page shows only the area the store
// names, headed by its name; a reveal switches the page and lands the
// named tab; stub areas are a compact placeholder island; in-area
// segmented controls swap the area's body. Panels are stubbed — this
// suite pins the page's composition, not the panels.

import { afterEach, describe, expect, it, vi } from 'vitest';
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
vi.mock('@/Function/settings/TypeSettings', () => ({ TypeSettings: ({ kind }: { kind: string }) => `Types panel: ${kind}` }));
vi.mock('@/Function/automation/AutomationSettings', () => ({ AutomationSettings: () => 'Automation panel' }));
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

afterEach(() => { cleanup(); });

const renderPage = () => render(
  <I18nProvider>
    <SettingsView />
  </I18nProvider>,
);

const shown = (c: HTMLElement) => [...c.querySelectorAll('[data-settings-area]')].map((s) => s.getAttribute('data-settings-area'));

describe('one area per page', () => {
  it('shows only the area the store names, headed by its name', () => {
    act(() => setActiveSettingsSection('workspace'));
    const view = renderPage();
    expect(shown(view.container)).toEqual(['workspace']);
    expect(screen.getByRole('heading', { name: 'Activity space' })).toBeTruthy();
    expect(screen.getByText('Space panel')).toBeTruthy();
    expect(screen.queryByText('Member panel')).toBeNull();
  });

  it('a reveal switches the page, landing the named tab', () => {
    const view = renderPage();
    act(() => setActiveSettingsSection('integrations', 'external'));
    expect(shown(view.container)).toEqual(['integrations']);
    expect(screen.getByText('Integrations panel: external')).toBeTruthy();
    act(() => setActiveSettingsSection('members'));
    expect(shown(view.container)).toEqual(['members']);
    expect(screen.getByText('Member panel')).toBeTruthy();
  });

  it('every area in the nav has a page', () => {
    const view = renderPage();
    for (const item of SETTINGS_NAV.flatMap((g) => g.items)) {
      act(() => setActiveSettingsSection(item.id));
      expect(shown(view.container)).toEqual([item.id]);
    }
  });

  it('a stub area is one compact placeholder island', () => {
    act(() => setActiveSettingsSection('calendar'));
    const view = renderPage();
    const island = [...view.container.querySelectorAll('div')].find((d) => d.className.includes('gloss-island'));
    expect(island?.textContent).toContain('settings are coming soon.');
  });

  it('Preferences is headed once', () => {
    act(() => setActiveSettingsSection('preferences'));
    renderPage();
    expect(screen.getAllByRole('heading', { name: 'Preferences' })).toHaveLength(1);
    expect(screen.getByText('General')).toBeTruthy();
  });
});

describe('in-area segmented controls', () => {
  it('Objects is its types', () => {
    act(() => setActiveSettingsSection('objects'));
    renderPage();
    expect(screen.getByText('Types panel: object')).toBeTruthy();
  });

  it('swaps the Elements body between Types, Labels and Templates', () => {
    act(() => setActiveSettingsSection('elements'));
    renderPage();
    expect(screen.getByText('Types panel: element')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Labels' }));
    expect(screen.getByText('Labels panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Templates' }));
    expect(screen.getByText('Templates panel')).toBeTruthy();
    expect(screen.queryByText('Labels panel')).toBeNull();
  });

  it('swaps the AI body between Harnesses and Connectors', () => {
    act(() => setActiveSettingsSection('integrations'));
    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: 'Connectors' }));
    expect(screen.getByText('Integrations panel: external')).toBeTruthy();
  });

  it('the SLA pointer row opens the Strategy page (the thresholds’ one home)', () => {
    act(() => setActiveSettingsSection('elements'));
    const view = renderPage();
    const section = renderHook(() => useActiveSettingsSection());
    expect(screen.getByText('Risk thresholds')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Strategy settings' }));
    expect(section.result.current).toBe('initiative');
    expect(shown(view.container)).toEqual(['initiative']);
    section.unmount();
  });
});
