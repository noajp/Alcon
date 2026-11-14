'use client';

import { openInApp } from '@/Function/shared/appNavigation';
import type React from 'react';
import { useSyncExternalStore } from 'react';
import { SlidersHorizontal, User, Bell, KeyRound, Plug, Globe, Users, Sparkles, Link2, Tag, FileText, Boxes } from '@/ui/icons';
import { DomainIcon, ObjectIcon, ElementIcon } from '@/Function/shared/conceptIcons';
import { NavStrategyIcon, NavAutomationIcon } from '@/Frame/sidebar/NavIcons';

// Shared Settings navigation model + a tiny external store for the page
// in view. The settings nav lives in the AppSidebar (replacing the Activity
// Space tree while in Settings mode); SettingsView renders the page the
// store names. Both read/write the store, so a nav click, a deep link and
// a restored screen all open the same page.
//
// One nav row is one page: nothing switches inside a page. The person's
// own settings come first, then one section per thing being set up
// (Strategy, Elements, Objects, AI) and the Space's administration last.
// Only pages with something to set are listed. A thing whose settings fit
// one page is that page alone, under its own name (Strategy): the row
// stands by itself, with no section label repeating it.

export interface SettingsNavItem {
  id: string;
  label: string;
  /** The page's heading, where the nav row is too short to stand alone
   *  ("Types" under Elements is headed "Element types"). */
  title?: string;
  /** What the page holds, for the nav's search — the names of its parts
   *  where the row's own name does not say them. */
  holds?: string[];
  icon: React.ComponentType<{ size?: number; className?: string }>;
}
export interface SettingsNavSection {
  title: string;
  items: SettingsNavItem[];
}

export const SETTINGS_NAV: SettingsNavSection[] = [
  {
    title: 'Personal',
    items: [
      { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
      { id: 'profile', label: 'Profile', icon: User },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'security', label: 'Security & access', icon: KeyRound },
    ],
  },
  {
    title: 'Strategy',
    items: [
      { id: 'strategy', label: 'Strategy', holds: ['Risk thresholds', 'Timeline'], icon: NavStrategyIcon },
    ],
  },
  {
    title: 'Elements',
    items: [
      { id: 'element-types', label: 'Types', title: 'Element types', icon: ElementIcon },
      { id: 'element-labels', label: 'Labels', title: 'Element labels', icon: Tag },
      { id: 'element-templates', label: 'Templates', title: 'Element templates', icon: FileText },
    ],
  },
  {
    title: 'Objects',
    items: [
      { id: 'objects', label: 'Types', title: 'Object types', icon: ObjectIcon },
    ],
  },
  {
    title: 'AI',
    items: [
      { id: 'harnesses', label: 'Harnesses', icon: Sparkles },
      { id: 'connectors', label: 'Connectors', icon: Plug },
      { id: 'automation', label: 'Automation', icon: NavAutomationIcon },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'workspace', label: 'Activity space', icon: Globe },
      { id: 'members', label: 'Members', icon: Users },
      { id: 'domain', label: 'Domains', icon: DomainIcon },
      { id: 'api', label: 'API', icon: Link2 },
      { id: 'assets', label: 'Connected assets', icon: Boxes },
    ],
  },
];

export const SETTINGS_ITEMS: Record<string, SettingsNavItem> = Object.fromEntries(
  SETTINGS_NAV.flatMap((s) => s.items.map((i) => [i.id, i])),
);

/** Pure. Whether the section of this name is one page under that same name,
 *  so its row needs no label above it. */
export function isLonePage(sectionTitle: string): boolean {
  const section = SETTINGS_NAV.find((s) => s.title === sectionTitle);
  return !!section && section.items.length === 1 && section.items[0].label === section.title;
}

/** Names a saved screen or a link may still carry for a part of a page:
 *  each opens the page that holds it. */
const PAGE_OF_PART: Record<string, string> = {
  initiative: 'strategy',
  timeline: 'strategy',
};

// ── External store: the page shown and a reveal nonce ──
// Settings opens on the first page of the nav. setActiveSettingsSection
// is a REVEAL (a sidebar click, a deep link, page.tsx's restore, the
// OAuth return): it bumps the nonce, so SettingsView shows that page from
// its top — re-revealing the page already shown starts it at the top
// again. The name of a part opens the page that holds it; an id the nav
// does not have opens the first page.
const FIRST_PAGE = SETTINGS_NAV[0].items[0];
interface ActiveSettings { section: string; nonce: number }
let active: ActiveSettings = { section: FIRST_PAGE.id, nonce: 0 };
const DEFAULT_ACTIVE: ActiveSettings = active;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Reveals a settings page. Always bumps the reveal nonce, even when the
 *  page is unchanged. */
export function setActiveSettingsSection(id: string) {
  const page = PAGE_OF_PART[id] ?? id;
  active = { section: SETTINGS_ITEMS[page] ? page : FIRST_PAGE.id, nonce: active.nonce + 1 };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useActiveSettingsSection(): string {
  return useSyncExternalStore(subscribe, () => active.section, () => DEFAULT_ACTIVE.section);
}

/** Increments on every reveal (and only on reveals) — SettingsView's
 *  cue to start the revealed page at its top. */
export function useSettingsRevealNonce(): number {
  return useSyncExternalStore(subscribe, () => active.nonce, () => DEFAULT_ACTIVE.nonce);
}

/** Opens Settings at the model connections, where an AI's API key is set. */
export function openModelKeySettings(): void {
  setActiveSettingsSection('connectors');
  openInApp('settings');
}
