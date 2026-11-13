/** @vitest-environment jsdom */
//
// Settings, one page per nav row: the page shows only what the store
// names, headed by its name, with nothing to switch inside it. Panels are
// stubbed — this suite pins the page's composition, not the panels.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@/Function/i18n/I18nProvider';
import { SETTINGS_NAV, setActiveSettingsSection } from '@/Function/settings/settingsNav';
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
vi.mock('@/Function/settings/SlaSettings', () => ({ SlaSettings: () => 'SLA panel' }));
vi.mock('@/Function/settings/TimelineSettings', () => ({ TimelineSettings: () => 'Timeline panel' }));
vi.mock('@/AIP/connectors/IntegrationsSettings', () => ({ ConnectorsSettings: () => 'Connectors panel' }));
vi.mock('@/AIP/harness/HarnessesPanel', () => ({ HarnessesPanel: () => 'Harnesses panel' }));
vi.mock('@/AIP/connectors/ClaywareConnectPanel', () => ({ ClaywareConnectPanel: () => 'API panel' }));
vi.mock('@/AIP/connectors/AssetRelayPanel', () => ({ AssetRelayPanel: () => 'Assets panel' }));
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

describe('one page per nav row', () => {
  it('shows only the page the store names, headed by its name', () => {
    act(() => setActiveSettingsSection('workspace'));
    const view = renderPage();
    expect(shown(view.container)).toEqual(['workspace']);
    expect(screen.getByRole('heading', { name: 'Activity space' })).toBeTruthy();
    expect(screen.getByText('Space panel')).toBeTruthy();
    expect(screen.queryByText('Member panel')).toBeNull();
  });

  it('a reveal switches the page', () => {
    const view = renderPage();
    act(() => setActiveSettingsSection('connectors'));
    expect(shown(view.container)).toEqual(['connectors']);
    expect(screen.getByText('Connectors panel')).toBeTruthy();
    act(() => setActiveSettingsSection('members'));
    expect(shown(view.container)).toEqual(['members']);
    expect(screen.getByText('Member panel')).toBeTruthy();
  });

  it('every page in the nav has a body and nothing to switch inside it', () => {
    const view = renderPage();
    for (const item of SETTINGS_NAV.flatMap((g) => g.items)) {
      act(() => setActiveSettingsSection(item.id));
      expect(shown(view.container)).toEqual([item.id]);
      const body = view.container.querySelector('[data-settings-area]')!;
      expect(body.textContent!.length).toBeGreaterThan((item.title ?? item.label).length);
    }
    expect(view.container.querySelector('[role="tablist"]')).toBeNull();
  });

  it('a short nav row is headed by its full name', () => {
    act(() => setActiveSettingsSection('element-labels'));
    renderPage();
    expect(screen.getByRole('heading', { name: 'Element labels' })).toBeTruthy();
    expect(screen.getByText('Labels panel')).toBeTruthy();
  });

  it('Elements and Objects each open their own types', () => {
    act(() => setActiveSettingsSection('element-types'));
    renderPage();
    expect(screen.getByText('Types panel: element')).toBeTruthy();
    act(() => setActiveSettingsSection('objects'));
    expect(screen.getByText('Types panel: object')).toBeTruthy();
  });

  it('Preferences is headed once', () => {
    act(() => setActiveSettingsSection('preferences'));
    renderPage();
    expect(screen.getAllByRole('heading', { name: 'Preferences' })).toHaveLength(1);
    expect(screen.getByText('General')).toBeTruthy();
  });
});
