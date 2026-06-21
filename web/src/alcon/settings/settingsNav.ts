'use client';

import { useSyncExternalStore } from 'react';
import {
  SlidersHorizontal, User, Bell, KeyRound, Plug,
  Tag, LayoutTemplate, Flame, Circle, RefreshCw,
  Sparkles, Target, FileText, MessageSquareText,
  Building2, Users, Shield, Code2, AppWindow, ArrowLeftRight,
  Hexagon,
  type LucideIcon,
} from 'lucide-react';

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
  icon: LucideIcon;
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
    title: 'Elements',
    items: [
      { id: 'el-labels', label: 'Labels', icon: Tag },
      { id: 'el-templates', label: 'Templates', icon: LayoutTemplate },
      { id: 'el-slas', label: 'SLAs', icon: Flame },
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
    title: 'Features',
    items: [
      { id: 'ai', label: 'AI & Agents', icon: Sparkles },
      { id: 'initiatives', label: 'Initiatives', icon: Target },
      { id: 'documents', label: 'Documents', icon: FileText },
      { id: 'requests', label: 'Customer requests', icon: MessageSquareText },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'workspace', label: 'Workspace', icon: Building2 },
      { id: 'members', label: 'Members', icon: Users },
      { id: 'admin-security', label: 'Security', icon: Shield },
      { id: 'api', label: 'API', icon: Code2 },
      { id: 'applications', label: 'Applications', icon: AppWindow },
      { id: 'import', label: 'Import & export', icon: ArrowLeftRight },
    ],
  },
  {
    title: 'Your Domains',
    items: [
      { id: 'domain', label: 'Domain', icon: Hexagon },
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
