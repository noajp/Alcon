'use client';

import { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/ui/button';
import { ProfileSettings } from './ProfileSettings';
import { AccountSettings } from './AccountSettings';
import { OPTIONS as THEME_OPTIONS, FONT_SIZES, FONT_SIZE_KEY, DEFAULT_FONT_KEY, applyFontSize } from './appearanceOptions';
import { TeamSettings } from './TeamSettings';
import { ActivitySpaceSettings } from './ActivitySpaceSettings';
import { MemberSettings } from './MemberSettings';
import { NotificationSettings } from './NotificationSettings';
import { SlaSettings } from './SlaSettings';
import { LabelSettings } from './LabelSettings';
import { ElementTemplateSettings } from './ElementTemplateSettings';
import { IntegrationsSettings } from '@/Function/integrations/IntegrationsSettings';
import { useActiveSpaceScope } from '@/Function/space/data';
import { settingsInScope } from '@/Function/space/spaceScope';
import { useActiveSettingsSection, useActiveSettingsTab, setActiveSettingsSection, SETTINGS_ITEMS, SETTINGS_ITEM_TITLES } from './settingsNav';
import { useUserPreferences, type UserPreferences } from './useUserPreferences';
import { LanguageSelect } from '@/Function/i18n/LanguageSelect';
import { Group, Row, SelectRow, ToggleRow } from './SettingsControls';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SettingsComingSoon } from './SettingsSection';
import { InitiativeJudgementSettings, PhaseDefaultsSettings } from './StrategySettingsPanels';

// =============================================================
// SettingsView — content pane only. The settings NAV lives in
// the AppSidebar (SettingsSidebarPanel); both share the active
// section via the settingsNav store, so this component just
// renders the panel for whatever section is selected.
//
// Alcon's vocabulary replaces Linear's: Issues → Elements,
// Projects → Objects, Team(s) → Domain(s).
//
// Panels with real implementations (Profile / Security / Domain / Activity
// space / Member / Integrations / Notifications / Preferences, and the Elements tabs
// Labels / Templates / SLAs) hold their own backing-store wiring; the rest
// fall through to ComingSoon. Objects and Elements are one page each with
// tabs — see settingsNav.
// =============================================================

export function SettingsView() {
  // An audit Space (ADR 0048) shows only its own pages; a page it hides
  // reads as the Space's own.
  const scope = useActiveSpaceScope();
  const stored = useActiveSettingsSection();
  const active = settingsInScope(stored, scope) ? stored : 'workspace';
  const storedTab = useActiveSettingsTab();
  const tab = active === stored ? storedTab : null;
  const { t } = useI18n();

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-3xl mx-auto px-10 py-10">
        {active === 'preferences' ? (
          <PreferencesPanel />
        ) : active === 'profile' ? (
          <PanelShell title={t('Profile')}><ProfileSettings /></PanelShell>
        ) : active === 'security' ? (
          <PanelShell title={t('Security & access')}><AccountSettings /></PanelShell>
        ) : active === 'workspace' ? (
          <PanelShell title={t('Activity space')}><ActivitySpaceSettings /></PanelShell>
        ) : active === 'domain' ? (
          <PanelShell title={t('Domain')}><TeamSettings /></PanelShell>
        ) : active === 'members' ? (
          <PanelShell title={t('Member')}><MemberSettings /></PanelShell>
        ) : active === 'integrations' ? (
          <TabbedPanel id="integrations" tab={tab}><IntegrationsSettings tab={tab} /></TabbedPanel>
        ) : active === 'notifications' ? (
          <PanelShell title={t('Notifications')}><NotificationSettings /></PanelShell>
        ) : active === 'elements' ? (
          <TabbedPanel id="elements" tab={tab}>
            {tab === 'templates' ? <ElementTemplateSettings /> : tab === 'slas' ? <SlaSettings /> : <LabelSettings />}
          </TabbedPanel>
        ) : active === 'initiative' ? (
          <PanelShell title={t('Initiative')}><InitiativeJudgementSettings /></PanelShell>
        ) : active === 'phase' ? (
          <PanelShell title={t('Phase')}><PhaseDefaultsSettings /></PanelShell>
        ) : active === 'objects' ? (
          <TabbedPanel id="objects" tab={tab}><SettingsComingSoon title={t(SETTINGS_ITEMS.objects.tabs!.find((x) => x.id === tab)?.label ?? 'Objects')} /></TabbedPanel>
        ) : (
          <ComingSoon title={t(SETTINGS_ITEM_TITLES[active] ?? 'Settings')} />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Preferences — the rich General + Interface/theme panel. The General
// group persists to `user_preferences` (owner_user-scoped) via
// useUserPreferences; App sidebar customization and pointer cursors are
// still local-only placeholders.
// =============================================================
function PreferencesPanel() {
  const { t } = useI18n();
  const { preferences, error, savePreference } = useUserPreferences();
  const [pointerCursors, setPointerCursors] = useState(false);

  // Real Theme + Font size, wired to next-themes and the UI-zoom store.
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [fontKey, setFontKey] = useState(DEFAULT_FONT_KEY);
  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(FONT_SIZE_KEY);
      if (saved && FONT_SIZES.some((f) => f.key === saved)) setFontKey(saved);
    } catch { /* ignore */ }
  }, []);

  const themeLabel = mounted ? (THEME_OPTIONS.find((o) => o.value === theme)?.label ?? 'System') : 'System';
  const setThemeByLabel = (label: string) => {
    const v = THEME_OPTIONS.find((o) => o.label === label)?.value;
    if (v) setTheme(v);
  };
  const fontLabel = FONT_SIZES.find((f) => f.key === fontKey)?.label ?? 'Default';
  const setFontByLabel = (label: string) => {
    const f = FONT_SIZES.find((x) => x.label === label);
    if (!f) return;
    setFontKey(f.key);
    applyFontSize(f.scale);
    try { window.localStorage.setItem(FONT_SIZE_KEY, f.key); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-10">
      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">{t('Preferences')}</h1>

      {error && (
        <div className="text-[12px] text-destructive px-1 -mt-6">
          {t("Couldn't save: {error}", { error })}
        </div>
      )}

      <Group title={t('General')}>
        <Row label={t('Language')} desc={t('Choose the language used across Alcon')}>
          <LanguageSelect />
        </Row>
        <SelectRow
          label={t('Default home view')}
          desc={t('Select which view to open when launching Alcon')}
          value={preferences.home_view}
          options={['Now', 'My Elements', 'Inbox', 'Calendar']}
          onChange={(v) => savePreference('home_view', v as UserPreferences['home_view'])}
        />
        <SelectRow
          label={t('Display names')}
          desc={t('How names are shown across the interface')}
          value={preferences.display_names}
          options={['Full name', 'Short name', 'Username']}
          onChange={(v) => savePreference('display_names', v as UserPreferences['display_names'])}
        />
        <SelectRow
          label={t('First day of the week')}
          desc={t('Used for date pickers')}
          value={preferences.first_day_of_week}
          options={['Monday', 'Sunday', 'Saturday']}
          onChange={(v) => savePreference('first_day_of_week', v as UserPreferences['first_day_of_week'])}
        />
        <ToggleRow
          label={t('Convert text emoticons into emojis')}
          desc={t('Strings like :) will be converted to 🙂')}
          value={preferences.convert_emoticons}
          onChange={(v) => savePreference('convert_emoticons', v)}
        />
        <SelectRow
          label={t('Send comment on…')}
          desc={t('Which key press submits a comment')}
          value={preferences.send_comment_shortcut}
          options={['⌘+Enter', 'Enter']}
          onChange={(v) => savePreference('send_comment_shortcut', v as UserPreferences['send_comment_shortcut'])}
        />
      </Group>

      <Group title={t('Interface and theme')}>
        <SelectRow
          label={t('Theme')}
          desc={t('Match the system or pick a colour theme')}
          value={themeLabel}
          options={THEME_OPTIONS.map((o) => o.label)}
          onChange={setThemeByLabel}
        />
        <Row label={t('App sidebar')} desc={t('Customize sidebar item visibility, ordering, and badge style')}>
          <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            {t('Customize')}
          </button>
        </Row>
        <SelectRow
          label={t('Font size')}
          desc={t('Adjust the size of text across the app')}
          value={fontLabel}
          options={FONT_SIZES.map((f) => f.label)}
          onChange={setFontByLabel}
        />
        <ToggleRow
          label={t('Use pointer cursors')}
          desc={t('Change the cursor to a pointer over interactive elements')}
          value={pointerCursors}
          onChange={setPointerCursors}
        />
      </Group>
    </div>
  );
}

// =============================================================
// Layout + control primitives (local, UI-only)
// =============================================================
function PanelShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">{title}</h1>
      {children}
    </div>
  );
}

// A page whose settings live under tabs (Objects, Elements). The tab strip
// is the same tab control as everywhere else; the active tab is shared
// with the sidebar's search through the settingsNav store.
function TabbedPanel({ id, tab, children }: { id: string; tab: string | null; children: React.ReactNode }) {
  const { t } = useI18n();
  const item = SETTINGS_ITEMS[id];
  return (
    <PanelShell title={t(item.label)}>
      <div className="flex gap-1" role="tablist" aria-label={t(item.label)}>
        {item.tabs?.map((x) => (
          <Button key={x.id} shape="tab" size="xs" variant={tab === x.id ? 'secondary' : 'ghost'} role="tab"
            aria-selected={tab === x.id} onClick={() => setActiveSettingsSection(id, x.id)}>{t(x.label)}</Button>
        ))}
      </div>
      {children}
    </PanelShell>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">{title}</h1>
      <SettingsComingSoon title={title} />
    </div>
  );
}

