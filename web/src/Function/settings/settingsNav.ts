'use client';

import type React from 'react';
import { useSyncExternalStore } from 'react';
import { SlidersHorizontal, User, Bell, KeyRound, Plug, Globe, Users, Sparkles, Link2 } from '@/ui/icons';
import { DomainIcon, ObjectIcon, ElementIcon } from '@/Function/shared/conceptIcons';
import {
  NavStrategyIcon, NavPhaseIcon,
  NavNoteIcon, NavTableIcon, NavTeamsIcon, NavCalendarIcon, NavWorkloadIcon,
} from '@/Frame/sidebar/NavIcons';

// Shared Settings navigation model + a tiny external store for the area
// in view. The settings nav lives in the AppSidebar (replacing the Activity
// Space tree while in Settings mode); SettingsView renders EVERY area on
// one stacked page (settings redesign §2) — both read/write the store so
// the sidebar's highlighted row follows the reader: a nav click reveals
// an area (SettingsView scrolls to it), and a scroll-spy keeps the store
// on the area actually in view.
//
// Sections follow the concept model: the Activity Space itself, then one
// section per classification (Strategy / Execution / Sustainment) listing
// its concepts, and the person's own settings last. A concept with several
// settings surfaces (AI, API & access, Elements) is one area whose body
// swaps behind an in-area segmented control, not a nav subtree.

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
        id: 'integrations', label: 'AI', icon: Sparkles,
        tabs: [
          { id: 'definitions', label: 'Harnesses' },
          { id: 'external', label: 'Connectors' },
        ],
      },
      {
        id: 'access', label: 'API & access', icon: Link2,
        tabs: [
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
      // Objects has no tabs: all four of its surfaces are still to come,
      // so the area is a single placeholder island (redesign §2.3) — a
      // segmented control over four empty panels is equipment without a
      // purpose.
      { id: 'objects', label: 'Objects', icon: ObjectIcon },
      {
        id: 'elements', label: 'Elements', icon: ElementIcon,
        // SLAs are not a tab here any more: the risk thresholds have ONE
        // home under Strategy (redesign §2.4); this area points there.
        tabs: [
          { id: 'labels', label: 'Labels' },
          { id: 'templates', label: 'Templates' },
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

// ── External store: the area in view, the last revealed tab, a nonce ──
// Settings opens on the first area of the nav. Three writers, one value:
//   · setActiveSettingsSection — a REVEAL (a sidebar click, a deep link,
//     page.tsx's restore, the OAuth return). It validates the tab exactly
//     as the old page store did and bumps the reveal nonce, so
//     SettingsView scrolls the area to the top — re-revealing the area
//     already in view re-scrolls to it.
//   · setSettingsSectionInView — the scroll-spy in SettingsView. It
//     follows the reader's scroll, so it changes the section WITHOUT a
//     nonce bump (the spy never causes a scroll) and leaves the tab
//     alone: the tab records the last reveal, which is what page.tsx
//     persists for restore.
//   · the in-area segmented controls keep their own per-area tab state
//     inside SettingsView, seeded by reveals.
const FIRST_PAGE = SETTINGS_NAV[0].items[0];
interface ActiveSettings { section: string; tab: string | null; nonce: number }
let active: ActiveSettings = { section: FIRST_PAGE.id, tab: FIRST_PAGE.tabs?.[0].id ?? null, nonce: 0 };
const DEFAULT_ACTIVE: ActiveSettings = active;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Reveals a settings area; `tab` picks one of the area's in-area tabs
 *  (the first when omitted or unknown). Always bumps the reveal nonce,
 *  even when the area and tab are unchanged. */
export function setActiveSettingsSection(id: string, tab?: string) {
  const tabs = SETTINGS_ITEMS[id]?.tabs;
  const nextTab = tabs ? (tabs.some((t) => t.id === tab) ? tab! : tabs[0].id) : null;
  active = { section: id, tab: nextTab, nonce: active.nonce + 1 };
  emit();
}

/** The scroll-spy's writer: the named area is the one in view now. */
export function setSettingsSectionInView(id: string) {
  if (!SETTINGS_ITEMS[id] || id === active.section) return;
  active = { ...active, section: id };
  emit();
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

/** Increments on every reveal (and only on reveals) — SettingsView's
 *  cue to seed the revealed area's tab and scroll to it. */
export function useSettingsRevealNonce(): number {
  return useSyncExternalStore(subscribe, () => active.nonce, () => DEFAULT_ACTIVE.nonce);
}

// ── The scroll-spy's pick (pure) ──────────────────────────────────────
/** One area shell's position as the spy's observer reports it; `top` is
 *  the shell's viewport-relative top edge. */
export interface SpyCandidate { id: string; top: number; intersecting: boolean }

/** Given the shells currently intersecting the spy's band, the area the
 *  reader has reached: the last visible shell whose top has crossed the
 *  spy line. Shells still below the line don't count; when none has
 *  crossed (the reader is up in the page's title zone), the highest
 *  visible shell wins; when nothing is visible (a fast flick between
 *  reports), the previous area stands rather than flickering the nav. */
export function spySectionAt(candidates: readonly SpyCandidate[], line: number, previous: string): string {
  const visible = candidates.filter((c) => c.intersecting);
  if (visible.length === 0) return previous;
  let reached: SpyCandidate | null = null;
  for (const c of visible) {
    if (c.top <= line && (!reached || c.top > reached.top)) reached = c;
  }
  if (reached) return reached.id;
  return visible.reduce((a, b) => (b.top < a.top ? b : a)).id;
}
