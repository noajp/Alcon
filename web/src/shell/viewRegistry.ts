import type React from 'react';
import {
  NavHomeIcon,
  NavInboxIcon,
  NavMyTasksIcon,
  NavObjectsIcon,
  NavStrategyIcon,
  NavRoomIcon,
  NavChatIcon,
  NavNoteIcon,
  NavBriefIcon,
  NavActionsIcon,
  NavDomainIcon,
  NavSettingsIcon,
} from '@/shell/sidebar/NavIcons';

// Single source of truth for the top-level *activity views* (the thing
// `AppTab.activeView` holds and `MainContent` switches on). Before this,
// id→label / id→icon were re-declared in WindowTabBar (VIEW_LABEL +
// VIEW_ICON), AppSidebar (MY/ACTION/EXECUTION_ITEMS) and a dead
// ICON_BAR_LAYERS — and they had drifted (chat / strategy / my-elements
// had no label and fell back to "Tab"). Everything reads from here now.
//
// NOTE: this is a different axis from `ObjectTabType` (the tabs *inside* an
// Object detail — Board/Gantt/Calendar/...). Those live in TabBar and are
// intentionally not part of this registry.

export type ViewId =
  | 'home'
  | 'inbox'
  | 'my-elements'
  | 'mytasks'
  | 'projects'
  | 'strategy'
  | 'room'
  | 'chat'
  | 'note'
  | 'notes'
  | 'brief'
  | 'actions'
  | 'domains'
  | 'reference'
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
  'my-elements': { label: 'My Elements', icon: NavMyTasksIcon },
  mytasks:       { label: 'Elements',    icon: NavMyTasksIcon },
  projects:      { label: 'Objects',     icon: NavObjectsIcon },
  strategy:      { label: 'Strategy',    icon: NavStrategyIcon },
  room:          { label: 'Room',        icon: NavRoomIcon },
  chat:          { label: 'Chat',        icon: NavChatIcon },
  note:          { label: 'Note',        icon: NavNoteIcon },
  notes:         { label: 'Note',        icon: NavNoteIcon },
  brief:         { label: 'Brief',       icon: NavBriefIcon },
  actions:       { label: 'Actions',     icon: NavActionsIcon },
  domains:       { label: 'Domains',     icon: NavDomainIcon },
  reference:     { label: 'Reference' },
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
