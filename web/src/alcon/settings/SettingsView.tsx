'use client';

import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/ui/dropdown-menu';
import { ProfileSettings } from './ProfileSettings';
import { AccountSettings } from './AccountSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { TeamSettings } from './TeamSettings';
import { ActivitySpaceSettings } from './ActivitySpaceSettings';
import { useActiveSettingsSection, SETTINGS_ITEM_TITLES } from './settingsNav';

// =============================================================
// SettingsView — content pane only. The settings NAV lives in
// the AppSidebar (SettingsSidebarPanel); both share the active
// section via the settingsNav store, so this component just
// renders the panel for whatever section is selected.
//
// Alcon's vocabulary replaces Linear's: Issues → Elements,
// Projects → Objects, Team(s) → Domain(s).
//
// UI-only for now: the Preferences controls hold local state
// (no persistence) so the layout can be reviewed before each
// setting is wired to its backing store. Panels that already
// have real implementations (Profile / Security / Domain) reuse
// the existing components.
// =============================================================

export function SettingsView() {
  const active = useActiveSettingsSection();

  return (
    <div className="h-full overflow-y-auto bg-card">
      <div className="max-w-3xl mx-auto px-10 py-10">
        {active === 'preferences' ? (
          <PreferencesPanel />
        ) : active === 'profile' ? (
          <PanelShell title="Profile"><ProfileSettings /></PanelShell>
        ) : active === 'security' ? (
          <PanelShell title="Security & access"><AccountSettings /></PanelShell>
        ) : active === 'workspace' ? (
          <PanelShell title="Activity space"><ActivitySpaceSettings /></PanelShell>
        ) : active === 'domain' ? (
          <PanelShell title="Domain"><TeamSettings /></PanelShell>
        ) : active === 'connected' || active === 'admin-security' ? (
          <PanelShell title={SETTINGS_ITEM_TITLES[active]}><AppearanceSettings /></PanelShell>
        ) : (
          <ComingSoon title={SETTINGS_ITEM_TITLES[active] ?? 'Settings'} />
        )}
      </div>
    </div>
  );
}

// =============================================================
// Preferences — the rich General + Interface/theme panel.
// Controls are UI-only (local state) for now.
// =============================================================
function PreferencesPanel() {
  const [homeView, setHomeView] = useState('My Elements');
  const [displayNames, setDisplayNames] = useState('Full name');
  const [firstDay, setFirstDay] = useState('Monday');
  const [emoticons, setEmoticons] = useState(true);
  const [sendComment, setSendComment] = useState('⌘+Enter');

  const [fontSize, setFontSize] = useState('Default');
  const [pointerCursors, setPointerCursors] = useState(false);
  const [theme, setTheme] = useState('System');

  return (
    <div className="space-y-10">
      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">Preferences</h1>

      <Group title="General">
        <SelectRow
          label="Default home view"
          desc="Select which view to open when launching Alcon"
          value={homeView}
          options={['My Elements', 'Inbox', 'Strategy', 'Domain']}
          onChange={setHomeView}
        />
        <SelectRow
          label="Display names"
          desc="How names are shown across the interface"
          value={displayNames}
          options={['Full name', 'Short name', 'Username']}
          onChange={setDisplayNames}
        />
        <SelectRow
          label="First day of the week"
          desc="Used for date pickers"
          value={firstDay}
          options={['Monday', 'Sunday', 'Saturday']}
          onChange={setFirstDay}
        />
        <ToggleRow
          label="Convert text emoticons into emojis"
          desc="Strings like :) will be converted to 🙂"
          value={emoticons}
          onChange={setEmoticons}
        />
        <SelectRow
          label="Send comment on…"
          desc="Which key press submits a comment"
          value={sendComment}
          options={['⌘+Enter', 'Enter']}
          onChange={setSendComment}
        />
      </Group>

      <Group title="Interface and theme">
        <SelectRow
          label="Theme"
          desc="Match the system or pick light / dark"
          value={theme}
          options={['System', 'Light', 'Dark']}
          onChange={setTheme}
        />
        <Row label="App sidebar" desc="Customize sidebar item visibility, ordering, and badge style">
          <button type="button" className="text-[13px] text-muted-foreground hover:text-foreground transition-colors">
            Customize
          </button>
        </Row>
        <SelectRow
          label="Font size"
          desc="Adjust the size of text across the app"
          value={fontSize}
          options={['Smaller', 'Default', 'Larger']}
          onChange={setFontSize}
        />
        <ToggleRow
          label="Use pointer cursors"
          desc="Change the cursor to a pointer over interactive elements"
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-[14px] font-semibold text-foreground mb-3">{title}</h2>
      <div className="rounded-lg border border-border/60 bg-[var(--surface-rail)]/40 px-4 divide-y divide-border/50">
        {children}
      </div>
    </div>
  );
}

function Row({
  label, desc, children,
}: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {desc && <div className="text-[12px] text-muted-foreground mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SelectRow({
  label, desc, value, options, onChange,
}: {
  label: string; desc?: string; value: string; options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label} desc={desc}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium border border-border/60 bg-muted/40 text-foreground hover:bg-muted/70 transition-colors"
          >
            {value}
            <ChevronDown size={12} className="opacity-60" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]">
          {options.map((opt) => (
            <DropdownMenuItem key={opt} onSelect={() => onChange(opt)} className="gap-2 text-[12px]">
              <span className="flex-1">{opt}</span>
              {value === opt && <Check size={12} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </Row>
  );
}

function ToggleRow({
  label, desc, value, onChange,
}: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row label={label} desc={desc}>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-[18px] w-8 items-center rounded-full transition-colors ${
          value ? 'bg-primary' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-[15px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </Row>
  );
}

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="space-y-6">
      <h1 className="text-[26px] font-semibold tracking-tight text-foreground">{title}</h1>
      <div className="rounded-lg border border-dashed border-border bg-[var(--surface-rail)]/30 px-6 py-12 text-center">
        <div className="text-[13px] text-muted-foreground">
          {title} settings are coming soon.
        </div>
      </div>
    </div>
  );
}
