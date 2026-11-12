'use client';

import type React from 'react';
import {
  NavInboxIcon,
  NavTeamsIcon as NavPersonalIcon,
  NavNoteIcon,
  NavTableIcon,
  NavFilesIcon,
  NavTeamsIcon,
  NavStrategyModeIcon,
  NavCalendarIcon,
  NavSlidesIcon,
  NavAiIcon,
} from '@/Frame/sidebar/NavIcons';
import type { ViewId } from '@/Frame/viewRegistry';

// The app's top-level modes. Strategy and the tools sit at the top of the
// sidebar; Inbox, Calendar and the AI at the right of the status bar, the
// avatar (Profile) at its left. Notebook and Slides open from Artifacts.
export type RailMode = 'personal' | 'inbox' | 'workspace' | 'notebook' | 'tables' | 'files' | 'slides' | 'team' | 'calendar' | 'ai';

export interface ModeMeta {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  defaultView: ViewId;
  views: readonly ViewId[];
}

export const MODE_META: Record<RailMode, ModeMeta> = {
  personal:  { label: 'Profile',   icon: NavPersonalIcon, defaultView: 'profile', views: ['my-elements', 'profile'] },
  inbox:     { label: 'Inbox',     icon: NavInboxIcon, defaultView: 'inbox', views: ['inbox'] },
  // Strategy and the Domains with their Objects and Elements. Strategy opens
  // first, the sidebar's top row; Phase stays routable but is not in the nav.
  workspace: { label: 'Workspace', icon: NavStrategyModeIcon, defaultView: 'strategy',
    views: ['strategy', 'phase', 'objects', 'domain-elements', 'domains', 'domain-overview'] },
  notebook:  { label: 'Notebook',  icon: NavNoteIcon, defaultView: 'note', views: ['note'] },
  tables:    { label: 'Table',     icon: NavTableIcon, defaultView: 'tables', views: ['tables'] },
  files:     { label: 'Artifacts', icon: NavFilesIcon, defaultView: 'files', views: ['files'] },
  slides:    { label: 'Slides',    icon: NavSlidesIcon, defaultView: 'slides', views: ['slides'] },
  // Team holds its load too ('workload' still opens it).
  team:      { label: 'Team',      icon: NavTeamsIcon, defaultView: 'team', views: ['team', 'workload'] },
  calendar:  { label: 'Calendar',  icon: NavCalendarIcon, defaultView: 'calendar', views: ['calendar', 'schedule'] },
  ai:        { label: 'Agent',     icon: NavAiIcon, defaultView: 'ai', views: ['ai'] },
};

/** Navigation, highlighting and the launcher read the same mode definitions. */
export function railModeOf(view: string): RailMode | null {
  return (Object.keys(MODE_META) as RailMode[]).find(mode =>
    MODE_META[mode].views.some(id => id === view)) ?? null;
}

/** The tools the command palette offers. None today: who is in what is a
 *  Domain's Members tab, not a screen of its own. */
export const TOOL_MODES: RailMode[] = [];
