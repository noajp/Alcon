'use client';

import { AutomationSettings } from '@/Function/automation/AutomationSettings';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { ProfileSettings } from './ProfileSettings';
import { AccountSettings } from './AccountSettings';
import { CHART_PALETTES } from '@/Function/shared/chartPalette';
import { TypeSettings } from './TypeSettings';
import { getCachedChartPalette, setCachedChartPalette, usePreference } from './preferencesStore';
import { OPTIONS as THEME_OPTIONS, FONT_SIZES, FONT_SIZE_KEY, DEFAULT_FONT_KEY, applyFontSize } from './appearanceOptions';
import { TeamSettings } from './TeamSettings';
import { ActivitySpaceSettings } from './ActivitySpaceSettings';
import { MemberSettings } from './MemberSettings';
import { NotificationSettings } from './NotificationSettings';
import { LabelSettings } from './LabelSettings';
import { ElementTemplateSettings } from './ElementTemplateSettings';
import { ConnectorsSettings } from '@/AIP/connectors/IntegrationsSettings';
import { AlconConnectPanel } from '@/AIP/connectors/AlconConnectPanel';
import { AssetRelayPanel } from '@/AIP/connectors/AssetRelayPanel';
import { HarnessesPanel } from '@/AIP/harness/HarnessesPanel';
import {
  SETTINGS_NAV, SETTINGS_ITEMS,
  useActiveSettingsSection, useSettingsRevealNonce,
  type SettingsNavItem,
} from './settingsNav';
import { useUserPreferences, type UserPreferences } from './useUserPreferences';
import { LanguageSelect } from '@/Function/i18n/LanguageSelect';
import { SettingsIsland, SettingRow, SelectRow, SegmentedRow, ToggleRow } from './SettingsControls';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SlaSettings } from './SlaSettings';
import { TimelineSettings } from './TimelineSettings';

// =============================================================
// SettingsView — content pane only. The settings NAV lives in
// the AppSidebar (SettingsSidebarPanel); both share the settingsNav
// store.
//
// One nav row is one page: the page is headed by its name and a one-line
// description, on the page ground (bg-background) so the property islands
// float, and everything it holds is stacked on it — nothing switches
// inside a page. A reveal (nav click / deep link / restore) opens the
// page at its top.
// =============================================================

/** One-line descriptions for the pages whose panels don't open with one
 *  of their own. */
const AREA_DESCRIPTIONS: Record<string, string> = {
  preferences: 'Language, appearance, and defaults for how Alcon works for you.',
  timeline: 'How the Timeline is drawn',
  harnesses: 'How AI carries out a kind of work: the goal, the steps, where it stops and asks, the shape of the result and the connectors it uses.',
  connectors: 'The outside services AI can use when it works in this Space.',
  automation: 'The work that runs by itself — open one to see and change its flow.',
  api: 'Let other AI tools and scripts read and update this Space as you, within your permissions.',
  assets: 'A local app or AI adds one line to its backend and announces itself here. It is recognized when an owner accepts it; from then on what it does is recorded in this Space.',
};

export function SettingsView() {
  const section = useActiveSettingsSection();
  const nonce = useSettingsRevealNonce();
  const scrollRef = useRef<HTMLDivElement>(null);

  // A reveal starts the page at its top.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [nonce]);

  const renderArea = (item: SettingsNavItem) => {
    switch (item.id) {
      case 'preferences': return <PreferencesPanel />;
      case 'profile': return <ProfileSettings />;
      case 'notifications': return <NotificationSettings />;
      case 'security': return <AccountSettings />;
      case 'initiative': return <SlaSettings />;
      case 'timeline': return <TimelineSettings />;
      case 'element-types': return <TypeSettings kind="element" />;
      case 'element-labels': return <LabelSettings />;
      case 'element-templates': return <ElementTemplateSettings />;
      case 'objects': return <TypeSettings kind="object" />;
      case 'harnesses': return <HarnessesPanel />;
      case 'connectors': return <ConnectorsSettings />;
      case 'automation': return <AutomationSettings />;
      case 'workspace': return <ActivitySpaceSettings />;
      case 'members': return <MemberSettings />;
      case 'domain': return <TeamSettings />;
      case 'api': return <AlconConnectPanel />;
      case 'assets': return <AssetRelayPanel />;
      default: return null;
    }
  };

  const item = SETTINGS_ITEMS[section] ?? SETTINGS_NAV[0].items[0];
  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-10 py-10">
        <AreaShell key={item.id} item={item} description={AREA_DESCRIPTIONS[item.id]}>
          {renderArea(item)}
        </AreaShell>
      </div>
    </div>
  );
}

// =============================================================
// Area shell — the page's heading: its name and one-line description
// above its body (the heading sits outside the islands).
// =============================================================
function AreaShell({
  item, description, children,
}: {
  item: SettingsNavItem; description?: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const title = t(item.title ?? item.label);
  return (
    <section data-settings-area={item.id} aria-label={title}>
      <div className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="text-[13px] text-muted-foreground mt-1">{t(description)}</p>
        )}
      </div>
      {children}
    </section>
  );
}

// =============================================================
// Preferences — General persists to `user_preferences` (owner-scoped)
// via useUserPreferences; Theme, Font size and Chart colors are
// device-local (next-themes / localStorage). Every row here is read
// somewhere in the app. Its heading is the area shell's — the panel
// itself starts at its islands.
// =============================================================
function PreferencesPanel() {
  const { t } = useI18n();
  const { preferences, error, savePreference } = useUserPreferences();

  // Real Theme + Font size, wired to next-themes and the UI-zoom store.
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [fontKey, setFontKey] = useState(DEFAULT_FONT_KEY);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of stored prefs after mount
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
  const chartPalette = usePreference(getCachedChartPalette);
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
      {error && (
        <div className="text-[12px] text-destructive px-1">
          {t("Couldn't save: {error}", { error })}
        </div>
      )}

      <SettingsIsland title={t('General')}>
        <SettingRow label={t('Language')} desc={t('Choose the language used across Alcon')}>
          <LanguageSelect />
        </SettingRow>
        <SegmentedRow
          label={t('Default home view')}
          desc={t('Select which view to open when launching Alcon')}
          value={preferences.home_view}
          options={['My Elements', 'Inbox', 'Calendar']}
          onChange={(v) => savePreference('home_view', v as UserPreferences['home_view'])}
        />
        <SegmentedRow
          label={t('Display names')}
          desc={t('How names are shown across the interface')}
          value={preferences.display_names}
          options={['Full name', 'Short name', 'Username']}
          onChange={(v) => savePreference('display_names', v as UserPreferences['display_names'])}
        />
        <ToggleRow
          label={t('Convert text emoticons into emojis')}
          desc={t('Strings like :) will be converted to 🙂')}
          value={preferences.convert_emoticons}
          onChange={(v) => savePreference('convert_emoticons', v)}
        />
        <SegmentedRow
          label={t('Send comment on…')}
          desc={t('Which key press submits a comment')}
          value={preferences.send_comment_shortcut}
          options={['⌘+Enter', 'Enter']}
          onChange={(v) => savePreference('send_comment_shortcut', v as UserPreferences['send_comment_shortcut'])}
        />
      </SettingsIsland>

      <SettingsIsland title={t('Interface and theme')}>
        <SelectRow
          label={t('Theme')}
          desc={t('Match the system or pick a colour theme')}
          value={themeLabel}
          options={THEME_OPTIONS.map((o) => o.label)}
          onChange={setThemeByLabel}
        />
        <SelectRow
          label={t('Font size')}
          desc={t('Adjust the size of text across the app')}
          value={fontLabel}
          options={FONT_SIZES.map((f) => f.label)}
          onChange={setFontByLabel}
        />
        <SelectRow
          label={t('Chart colors')}
          desc={t('The colors charts draw in, across the app')}
          value={(CHART_PALETTES.find((p) => p.key === chartPalette) ?? CHART_PALETTES[0]).label}
          options={CHART_PALETTES.map((p) => p.label)}
          onChange={(label) => { const p = CHART_PALETTES.find((x) => x.label === label); if (p) setCachedChartPalette(p.key); }}
        />
      </SettingsIsland>
    </div>
  );
}
