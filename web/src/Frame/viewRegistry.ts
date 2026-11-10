import type React from 'react';
import {
  NavAiIcon,
  NavHomeIcon,
  NavInboxIcon,
  NavCalendarIcon,
  NavMyTasksIcon,
  NavObjectsIcon,
  NavStrategyIcon,
  NavNoteIcon,
  NavSettingsIcon,
  NavTableIcon, NavSlidesIcon, NavFilesIcon,
  NavTeamsIcon,
  NavDomainIcon,
  NavPhaseIcon,
  NavWorkloadIcon,
  NavTimelineIcon,
} from '@/Frame/sidebar/NavIcons';

// Single source of truth for the top-level *activity views* (the thing
// `AppTab.activeView` holds and `MainContent` switches on). Every surface that
// needs a view's label or icon — the sidebar's mode sections, the
// command palette — reads it from here, so the two can never drift apart.
//
// NOTE: this is a different axis from `ObjectTabType` (the tabs *inside* an
// Object detail — Board/Gantt/Calendar/...). Those live in TabBar and are
// intentionally not part of this registry.

export type ViewId =
  | 'home'
  | 'inbox'
  | 'calendar'
  | 'schedule'
  | 'my-elements'
  | 'domain-elements'
  | 'objects'
  | 'strategy'
  | 'phase'
  | 'workload'
  | 'timeline'
  | 'note'
  | 'domain-overview'
  | 'domains'
  | 'tables'
  | 'files'
  | 'slides'
  | 'team'
  | 'settings'
  | 'profile'
  | 'account'
  | 'ai';

export interface ViewMeta {
  /** Sidebar / tab display label. */
  label: string;
  /** Nav icon, where the view has one. */
  icon?: React.ComponentType<{ size?: number }>;
}

export const VIEW_REGISTRY: Record<ViewId, ViewMeta> = {
  home:          { label: 'Now',        icon: NavHomeIcon },
  inbox:         { label: 'Inbox',       icon: NavInboxIcon },
  calendar:      { label: 'Calendar',    icon: NavCalendarIcon },
  schedule:      { label: 'Calendar',    icon: NavCalendarIcon },
  'my-elements': { label: 'My Elements', icon: NavMyTasksIcon },
  'domain-elements':       { label: 'Elements',    icon: NavMyTasksIcon },
  objects:      { label: 'Objects',     icon: NavObjectsIcon },
  strategy:      { label: 'Strategy',    icon: NavStrategyIcon },
  phase:         { label: 'Phase',       icon: NavPhaseIcon },
  workload:      { label: 'Workload',    icon: NavWorkloadIcon },
  timeline:      { label: 'Timeline',    icon: NavTimelineIcon },
  note:          { label: 'Notebook',    icon: NavNoteIcon },
  'domain-overview': { label: 'Domain overview', icon: NavDomainIcon },
  domains:       { label: 'Domains',     icon: NavDomainIcon },
  tables:        { label: 'Table',       icon: NavTableIcon },
  files:         { label: 'Artifacts',   icon: NavFilesIcon },
  slides:        { label: 'Slides',      icon: NavSlidesIcon },
  team:          { label: 'Team',        icon: NavTeamsIcon },
  settings:      { label: 'Settings',    icon: NavSettingsIcon },
  profile:       { label: 'Profile', icon: NavTeamsIcon },
  account:       { label: 'Account' },
  ai:            { label: 'AI',          icon: NavAiIcon },
};

