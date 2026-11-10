'use client';

import { AutomationSettings } from '@/Function/automation/AutomationSettings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { ProfileSettings } from './ProfileSettings';
import { AccountSettings } from './AccountSettings';
import { OPTIONS as THEME_OPTIONS, FONT_SIZES, FONT_SIZE_KEY, DEFAULT_FONT_KEY, applyFontSize, POINTER_CURSOR_KEY } from './appearanceOptions';
import { TeamSettings } from './TeamSettings';
import { ActivitySpaceSettings } from './ActivitySpaceSettings';
import { MemberSettings } from './MemberSettings';
import { NotificationSettings } from './NotificationSettings';
import { LabelSettings } from './LabelSettings';
import { ElementTemplateSettings } from './ElementTemplateSettings';
import { IntegrationsSettings } from '@/AIP/connectors/IntegrationsSettings';
import {
  SETTINGS_NAV, SETTINGS_ITEMS,
  useActiveSettingsSection, useActiveSettingsTab, useSettingsRevealNonce,
  setActiveSettingsSection, setSettingsSectionInView, spySectionAt,
  type SettingsNavItem,
} from './settingsNav';
import { useUserPreferences, type UserPreferences } from './useUserPreferences';
import { LanguageSelect } from '@/Function/i18n/LanguageSelect';
import { SettingsIsland, SettingRow, SelectRow, SegmentedRow, SegmentedControl, ToggleRow, SettingsComingSoon } from './SettingsControls';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { InitiativeJudgementSettings, PhaseDefaultsSettings } from './StrategySettingsPanels';
import { FONT } from '@/shared/designTokens';

// =============================================================
// SettingsView — content pane only. The settings NAV lives in
// the AppSidebar (SettingsSidebarPanel); both share the settingsNav
// store.
//
// Settings is ONE page (redesign §2): every area renders, stacked
// under its nav group heading, on the page ground (bg-background) so
// the property islands float. There is no panel switch — the store
// names the area in view, a reveal (nav click / deep link / restore)
// scrolls to it, and an IntersectionObserver scroll-spy keeps the
// store on the area the reader is actually looking at. Areas that
// subdivide (AI, API & access, Elements) swap only their own body
// behind an in-area segmented control; their per-area tab state lives
// here, seeded by reveals.
//
// Alcon's vocabulary replaces Linear's: Issues → Elements,
// Projects → Objects, Team(s) → Domain(s).
// =============================================================

/** Where the scroll-spy's "current area" line sits: this far below the
 *  scroll container's top edge. */
const SPY_LINE_OFFSET = 96;

/** One-line descriptions for the areas whose panels don't carry one of
 *  their own yet (redesign §7); the rest gain theirs as their panels
 *  convert in PR3/PR4a. */
const AREA_DESCRIPTIONS: Record<string, string> = {
  integrations: 'The harnesses Athena works by, and the services connected to this Space.',
  access: 'Tokens, endpoints and connected machines — the ways other tools work with Alcon.',
  automation: 'The work that runs by itself — open one to see and change its flow.',
  elements: 'Labels and templates for Elements, set per Domain.',
  preferences: 'Language, appearance, and defaults for how Alcon works for you.',
};

export function SettingsView() {
  const { t } = useI18n();
  const section = useActiveSettingsSection();
  const revealTab = useActiveSettingsTab();
  const nonce = useSettingsRevealNonce();
  const scrollRef = useRef<HTMLDivElement>(null);
  const areaRefs = useRef(new Map<string, HTMLElement>());
  const sectionRef = useRef(section);
  useEffect(() => { sectionRef.current = section; });
  const handledNonce = useRef(-1);
  // The spy stands down while a reveal's programmatic scroll settles,
  // so it can't fight the reveal for the store (redesign §11 D8).
  const spySuspended = useRef(false);
  const suspendTimers = useRef<{ cap?: number; settle?: number }>({});
  // Per-area in-area tab state, seeded by reveals. Segmented clicks
  // write here only — never through the reveal path — so swapping a
  // body never scrolls the page (redesign §2.3).
  const [areaTabs, setAreaTabs] = useState<Record<string, string>>({});

  const registerShell = useCallback((id: string, el: HTMLElement | null) => {
    if (el) areaRefs.current.set(id, el);
    else areaRefs.current.delete(id);
  }, []);

  const tabFor = (item: SettingsNavItem): string | null => {
    if (!item.tabs) return null;
    const chosen = areaTabs[item.id];
    return chosen && item.tabs.some((x) => x.id === chosen) ? chosen : item.tabs[0].id;
  };

  // A reveal: seed the area's tab, then scroll its shell to the top.
  useEffect(() => {
    if (handledNonce.current === nonce) return;
    handledNonce.current = nonce;
    const item = SETTINGS_ITEMS[section];
    if (item?.tabs && revealTab) {
      setAreaTabs((prev) => (prev[section] === revealTab ? prev : { ...prev, [section]: revealTab }));
    }
    const el = areaRefs.current.get(section);
    if (!el) return;
    spySuspended.current = true;
    window.clearTimeout(suspendTimers.current.cap);
    suspendTimers.current.cap = window.setTimeout(() => { spySuspended.current = false; }, 1000);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [nonce, section, revealTab]);

  // The scroll-spy: observe the area shells; the pure pick
  // (spySectionAt) decides which one the reader has reached.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, { top: number; intersecting: boolean }>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.settingsArea;
        if (id) seen.set(id, { top: e.boundingClientRect.top, intersecting: e.isIntersecting });
      }
      if (spySuspended.current) return;
      const line = root.getBoundingClientRect().top + SPY_LINE_OFFSET;
      const candidates = SETTINGS_NAV.flatMap((g) => g.items).map((i) => {
        const s = seen.get(i.id);
        return { id: i.id, top: s?.top ?? Number.POSITIVE_INFINITY, intersecting: s?.intersecting ?? false };
      });
      setSettingsSectionInView(spySectionAt(candidates, line, sectionRef.current));
    }, { root, rootMargin: '0px 0px -55% 0px', threshold: 0 });
    areaRefs.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // Scrolling again after a reveal means it has settled (or the reader
  // took over): lift the spy's suspension early.
  const onScroll = () => {
    if (!spySuspended.current) return;
    window.clearTimeout(suspendTimers.current.settle);
    suspendTimers.current.settle = window.setTimeout(() => { spySuspended.current = false; }, 200);
  };

  const renderArea = (item: SettingsNavItem) => {
    switch (item.id) {
      case 'workspace': return <ActivitySpaceSettings />;
      case 'members': return <MemberSettings />;
      case 'integrations':
      case 'access': {
        const tab = tabFor(item);
        return (
          <>
            <AreaTabs item={item} value={tab} onChange={(next) => setAreaTabs((prev) => ({ ...prev, [item.id]: next }))} />
            <IntegrationsSettings tab={tab} />
          </>
        );
      }
      case 'automation': return <AutomationSettings />;
      case 'initiative': return <InitiativeJudgementSettings />;
      case 'phase': return <PhaseDefaultsSettings />;
      case 'domain': return <TeamSettings />;
      case 'elements': {
        const tab = tabFor(item);
        return (
          <>
            <AreaTabs item={item} value={tab} onChange={(next) => setAreaTabs((prev) => ({ ...prev, [item.id]: next }))} />
            {tab === 'templates' ? <ElementTemplateSettings /> : <LabelSettings />}
            <SlaPointerRow />
          </>
        );
      }
      case 'preferences': return <PreferencesPanel />;
      case 'profile': return <ProfileSettings />;
      case 'notifications': return <NotificationSettings />;
      case 'security': return <AccountSettings />;
      // Objects and the Sustainment/Connected stubs: one compact
      // placeholder island each (redesign §2.1).
      default: return <PlaceholderIsland title={t(item.label)} />;
    }
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto bg-background">
      <div className="max-w-3xl mx-auto px-10 py-10">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight text-foreground">{t('Settings')}</h1>
          <p className="text-[13px] text-muted-foreground mt-1.5">
            {t('Your Space, how Athena works in it, and your own preferences — every setting on one page.')}
          </p>
        </div>

        {SETTINGS_NAV.map((group) => (
          <div key={group.title} className="mt-12">
            <div className="text-[12px] font-medium text-muted-foreground/80">{t(group.title)}</div>
            <div className="mt-4 space-y-10">
              {group.items.map((item) => (
                <AreaShell key={item.id} item={item} description={AREA_DESCRIPTIONS[item.id]} registerShell={registerShell}>
                  {renderArea(item)}
                </AreaShell>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================
// Area shell — the area's heading + one-line description above its
// body (Linear's pattern: the heading sits outside the islands).
// The shell is the reveal target and the spy's observed element.
// =============================================================
function AreaShell({
  item, description, registerShell, children,
}: {
  item: SettingsNavItem; description?: string;
  registerShell: (id: string, el: HTMLElement | null) => void;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section
      ref={(el) => registerShell(item.id, el)}
      data-settings-area={item.id}
      aria-label={t(item.label)}
      className="scroll-mt-6"
    >
      <div className="mb-2">
        <h2 className={`${FONT.lg} text-foreground`}>{t(item.label)}</h2>
        {description && (
          <p className="text-[12px] text-muted-foreground mt-0.5">{t(description)}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/** The in-area subdivision as a segmented control (redesign §2.3): it
 *  swaps only this area's body; the page and every other area stay put. */
function AreaTabs({
  item, value, onChange,
}: { item: SettingsNavItem; value: string | null; onChange: (tab: string) => void }) {
  const { t } = useI18n();
  const tabs = item.tabs!;
  const current = tabs.find((x) => x.id === value) ?? tabs[0];
  return (
    <div className="mb-5">
      <SegmentedControl
        label={t(item.label)}
        value={current.label}
        options={tabs.map((x) => x.label)}
        onChange={(label) => {
          const next = tabs.find((x) => x.label === label);
          if (next) onChange(next.id);
        }}
      />
    </div>
  );
}

/** A settings surface that has nothing to set yet, as one compact
 *  island: the coming-soon line is the island's only row. */
function PlaceholderIsland({ title }: { title: string }) {
  return (
    <SettingsIsland>
      <div className="px-5">
        <SettingsComingSoon title={title} />
      </div>
    </SettingsIsland>
  );
}

/** The risk thresholds (SLAs) have ONE home, under Strategy; this
 *  quiet row points there from Elements, in the shape the approval
 *  mode's pointer row set (redesign §2.4). */
function SlaPointerRow() {
  const { t } = useI18n();
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
      <span className="font-medium text-foreground">{t('Risk thresholds')}</span>
      <span>{t('Set under Strategy')}</span>
      <button type="button" onClick={() => setActiveSettingsSection('initiative')}
        className="underline underline-offset-2 transition-colors hover:text-foreground">
        {t('Go to Strategy settings')}
      </button>
    </div>
  );
}

// =============================================================
// Preferences — the rich General + Interface/theme panel, and the pilot
// for the settings redesign's primitives: groups render as property
// islands, short enums as segmented controls, booleans on the shared
// Switch. The General group persists to `user_preferences`
// (owner_user-scoped) via useUserPreferences; Theme, Font size and
// pointer cursors are device-local (next-themes / localStorage); the
// App sidebar row is still a placeholder action. Its heading is the
// area shell's — the panel itself starts at its islands.
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of stored prefs after mount
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(FONT_SIZE_KEY);
      if (saved && FONT_SIZES.some((f) => f.key === saved)) setFontKey(saved);
      setPointerCursors(window.localStorage.getItem(POINTER_CURSOR_KEY) === '1');
    } catch { /* ignore */ }
  }, []);

  const setPointerCursorsPersisted = (v: boolean) => {
    setPointerCursors(v);
    try { window.localStorage.setItem(POINTER_CURSOR_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };

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
          options={['Now', 'My Elements', 'Inbox', 'Calendar']}
          onChange={(v) => savePreference('home_view', v as UserPreferences['home_view'])}
        />
        <SegmentedRow
          label={t('Display names')}
          desc={t('How names are shown across the interface')}
          value={preferences.display_names}
          options={['Full name', 'Short name', 'Username']}
          onChange={(v) => savePreference('display_names', v as UserPreferences['display_names'])}
        />
        <SegmentedRow
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
        <SettingRow label={t('App sidebar')} desc={t('Customize sidebar item visibility, ordering, and badge style')}>
          <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            {t('Customize')}
          </button>
        </SettingRow>
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
          onChange={setPointerCursorsPersisted}
        />
      </SettingsIsland>
    </div>
  );
}
