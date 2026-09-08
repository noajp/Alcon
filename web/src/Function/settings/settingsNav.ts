'use client';

import type React from 'react';
import { useSyncExternalStore } from 'react';
import {
  SlidersHorizontal, User, Bell, KeyRound, Plug,
  Tag, LayoutTemplate, Flame, Circle, RefreshCw,
  Globe, Users,
} from 'lucide-react';
import { DomainIcon } from '@/Function/shared/conceptIcons';

// Shared Settings navigation model + a tiny external store for the active
// section. The settings nav lives in the AppSidebar (replacing the Activity
// Space tree while in Settings mode), and SettingsView renders the matching
// content panel — both read/write `activeSettingsSection` so they stay in sync.
//
// Alcon's vocabulary replaces Linear's: Issues → Elements, Projects → Objects,
// Team(s) → Domain(s).

export interface SettingsNavItem {
  id: string;
  label: string;
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
      { id: 'connected', label: 'Connected accounts', icon: Plug },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'workspace', label: 'Activity space', icon: Globe },
      { id: 'domain', label: 'Domain', icon: DomainIcon },
      { id: 'members', label: 'Member', icon: Users },
    ],
  },
  {
    title: 'Objects',
    items: [
      { id: 'ob-labels', label: 'Labels', icon: Tag },
      { id: 'ob-statuses', label: 'Statuses', icon: Circle },
      { id: 'ob-templates', label: 'Templates', icon: LayoutTemplate },
      { id: 'ob-updates', label: 'Updates', icon: RefreshCw },
    ],
  },
  {
    title: 'Elements',
    items: [
      { id: 'el-labels', label: 'Labels', icon: Tag },
      { id: 'el-templates', label: 'Templates', icon: LayoutTemplate },
      { id: 'el-slas', label: 'SLAs', icon: Flame },
    ],
  },
];

export const SETTINGS_ITEM_TITLES: Record<string, string> = Object.fromEntries(
  SETTINGS_NAV.flatMap((s) => s.items.map((i) => [i.id, i.label])),
);

// ── External store for the active section ────────────────────────────
const DEFAULT_SECTION = 'preferences';
let activeSection = DEFAULT_SECTION;
const listeners = new Set<() => void>();

export function setActiveSettingsSection(id: string) {
  if (id === activeSection) return;
  activeSection = id;
  listeners.forEach((l) => l());
}

export function useActiveSettingsSection(): string {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => activeSection,
    () => DEFAULT_SECTION,
  );
}
