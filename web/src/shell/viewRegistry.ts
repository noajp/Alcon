import type React from 'react';
import {
  NavHomeIcon,
  NavInboxIcon,
  NavCalendarIcon,
  NavMyTasksIcon,
  NavObjectsIcon,
  NavStrategyIcon,
  NavRoomIcon,
  NavChatIcon,
  NavNoteIcon,
  NavBriefIcon,
  NavActionsIcon,
  NavSettingsIcon,
  NavTableIcon,
  NavTeamsIcon,
  NavDomainIcon,
  NavPhaseIcon,
  NavWorkloadIcon,
  NavTimelineIcon,
} from '@/shell/sidebar/NavIcons';

// Single source of truth for the top-level *activity views* (the thing
// `AppTab.activeView` holds and `MainContent` switches on). Every surface that
// needs a view's label or icon — the tab bar, the sidebar's mode sections, the
// command palette — reads it from here, so the two can never drift apart.
//
// NOTE: this is a different axis from `ObjectTabType` (the tabs *inside* an
// Object detail — Board/Gantt/Calendar/...). Those live in TabBar and are
// intentionally not part of this registry.

export type ViewId =
  | 'home'
  | 'inbox'
  | 'calendar'
  | 'my-elements'
  | 'domain-elements'
  | 'objects'
  | 'strategy'
  | 'phase'
  | 'workload'
  | 'timeline'
  | 'room'
  | 'chat'
  | 'note'
  | 'notes'
  | 'brief'
  | 'actions'
  | 'domains'
  | 'tables'
  | 'team'
  | 'settings'
  | 'account';

export interface ViewMeta {
  /** Sidebar / tab display label. */
  label: string;
  /** Nav icon, where the view has one. */
  icon?: React.ComponentType<{ size?: number }>;
}

export const VIEW_REGISTRY: Record<ViewId, ViewMeta> = {
  home:          { label: 'Home',        icon: NavHomeIcon },
  inbox:         { label: 'Inbox',       icon: NavInboxIcon },
  calendar:      { label: 'Calendar',    icon: NavCalendarIcon },
  'my-elements': { label: 'My Elements', icon: NavMyTasksIcon },
  'domain-elements':       { label: 'Elements',    icon: NavMyTasksIcon },
  objects:      { label: 'Objects',     icon: NavObjectsIcon },
  strategy:      { label: 'Campaign',    icon: NavStrategyIcon },
  phase:         { label: 'Phase',       icon: NavPhaseIcon },
  workload:      { label: 'Workload',    icon: NavWorkloadIcon },
  timeline:      { label: 'Timeline',    icon: NavTimelineIcon },
  room:          { label: 'Room',        icon: NavRoomIcon },
  chat:          { label: 'Chat',        icon: NavChatIcon },
  note:          { label: 'Notebook',    icon: NavNoteIcon },
  notes:         { label: 'Notebook',    icon: NavNoteIcon },
  brief:         { label: 'Brief',       icon: NavBriefIcon },
  actions:       { label: 'Actions',     icon: NavActionsIcon },
  domains:       { label: 'Domains',     icon: NavDomainIcon },
  tables:        { label: 'Table',       icon: NavTableIcon },
  team:          { label: 'Team',        icon: NavTeamsIcon },
  settings:      { label: 'Settings',    icon: NavSettingsIcon },
  account:       { label: 'Account' },
};

/** Display label for an activity view id. Falls back to 'Tab' for unknown
 *  ids so persisted/legacy tab state never renders blank. */
export function viewLabel(id: string): string {
  return VIEW_REGISTRY[id as ViewId]?.label ?? 'Tab';
}

/** Nav icon for an activity view id, or undefined when it has none. */
export function viewIcon(id: string): React.ComponentType<{ size?: number }> | undefined {
  return VIEW_REGISTRY[id as ViewId]?.icon;
}
