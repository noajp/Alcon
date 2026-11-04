'use client';

import type React from 'react';
import { useSyncExternalStore } from 'react';
import { SlidersHorizontal, User, Bell, KeyRound, Plug, Globe, Users, Blocks } from '@/ui/icons';
import { DomainIcon, ObjectIcon, ElementIcon } from '@/Function/shared/conceptIcons';
import {
  NavStrategyIcon, NavPhaseIcon,
  NavNoteIcon, NavTableIcon, NavTeamsIcon, NavCalendarIcon, NavWorkloadIcon,
} from '@/shell/sidebar/NavIcons';

// Shared Settings navigation model + a tiny external store for the active
// page. The settings nav lives in the AppSidebar (replacing the Activity
// Space tree while in Settings mode), and SettingsView renders the matching
// content panel — both read/write the store so they stay in sync.
//
// Sections follow the concept model: the Activity Space itself, then one
// section per classification (Strategy / Execution / Sustainment) listing
// its concepts, and the person's own settings last. A concept with several settings
// surfaces (Objects, Elements) is one page with tabs, not a nav subtree.

export interface SettingsNavTab {
  id: string;
  label: string;
}
export interface SettingsNavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tabs?: SettingsNavTab[];
}
export interface SettingsNavSection {
  title: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    title: 'Activity settings',
    items: [
      { id: 'workspace', label: 'Activity space', icon: Globe },
      { id: 'members', label: 'Member', icon: Users },
      {
        id: 'integrations', label: 'Customize', icon: Blocks,
        tabs: [
          { id: 'definitions', label: 'Definitions' },
          { id: 'external', label: 'Connectors' },
          { id: 'packs', label: 'Packs' },
          { id: 'alcon', label: 'Connect to Alcon' },
          { id: 'assets', label: 'Connected assets' },
        ],
      },
    ],
  },
  {
    title: 'Strategy settings',
    items: [
      { id: 'initiative', label: 'Strategy', icon: NavStrategyIcon },
      { id: 'phase', label: 'Phase', icon: NavPhaseIcon },
    ],
  },
  {
    title: 'Execution settings',
    items: [
      { id: 'domain', label: 'Domain', icon: DomainIcon },
      {
        id: 'objects', label: 'Objects', icon: ObjectIcon,
        tabs: [
          { id: 'labels', label: 'Labels' },
          { id: 'statuses', label: 'Statuses' },
          { id: 'templates', label: 'Templates' },
          { id: 'updates', label: 'Updates' },
        ],
      },
      {
        id: 'elements', label: 'Elements', icon: ElementIcon,
        tabs: [
          { id: 'labels', label: 'Labels' },
          { id: 'templates', label: 'Templates' },
          { id: 'slas', label: 'SLAs' },
        ],
      },
    ],
  },
  {
    title: 'Sustainment settings',
    items: [
      { id: 'notebook', label: 'Notebook', icon: NavNoteIcon },
      { id: 'table', label: 'Table', icon: NavTableIcon },
      { id: 'team', label: 'People', icon: NavTeamsIcon },
      { id: 'calendar', label: 'Calendar', icon: NavCalendarIcon },
      { id: 'workload', label: 'Workload', icon: NavWorkloadIcon },
    ],
  },
  {
    title: 'Personal',
    items: [
      { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
      { id: 'profile', label: 'Profile', icon: User },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'security', label: 'Security & access', icon: KeyRound },
      { id: 'connected', label: 'Connected accounts', icon: Plug },
    ],
  },
];

export const SETTINGS_ITEMS: Record<string, SettingsNavItem> = Object.fromEntries(
  SETTINGS_NAV.flatMap((s) => s.items.map((i) => [i.id, i])),
);

export const SETTINGS_ITEM_TITLES: Record<string, string> = Object.fromEntries(
  SETTINGS_NAV.flatMap((s) => s.items.map((i) => [i.id, i.label])),
);

// ── External store for the active page (and its tab, when it has tabs) ──
// Settings opens on the first page of the nav (on its first tab, if any).
const FIRST_PAGE = SETTINGS_NAV[0].items[0];
interface ActiveSettings { section: string; tab: string | null }
let active: ActiveSettings = { section: FIRST_PAGE.id, tab: FIRST_PAGE.tabs?.[0].id ?? null };
const DEFAULT_ACTIVE: ActiveSettings = active;
const listeners = new Set<() => void>();

/** Opens a settings page; `tab` picks one of the page's tabs (the first
 *  when omitted or unknown). */
export function setActiveSettingsSection(id: string, tab?: string) {
  const tabs = SETTINGS_ITEMS[id]?.tabs;
  const nextTab = tabs ? (tabs.some((t) => t.id === tab) ? tab! : tabs[0].id) : null;
  if (id === active.section && nextTab === active.tab) return;
  active = { section: id, tab: nextTab };
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useActiveSettingsSection(): string {
  return useSyncExternalStore(subscribe, () => active.section, () => DEFAULT_ACTIVE.section);
}

export function useActiveSettingsTab(): string | null {
  return useSyncExternalStore(subscribe, () => active.tab, () => DEFAULT_ACTIVE.tab);
}
