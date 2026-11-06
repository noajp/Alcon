'use client';

import type React from 'react';
import { GitCompare } from '@/ui/icons';
import {
  NavAuditIcon,
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
export type RailMode = 'personal' | 'inbox' | 'workspace' | 'reviews' | 'notebook' | 'tables' | 'files' | 'slides' | 'team' | 'calendar' | 'audit' | 'ai';

export interface ModeMeta {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  defaultView: ViewId;
  views: readonly ViewId[];
}

export const MODE_META: Record<RailMode, ModeMeta> = {
  personal:  { label: 'Profile',   icon: NavPersonalIcon, defaultView: 'profile', views: ['home', 'my-elements', 'profile'] },
  inbox:     { label: 'Inbox',     icon: NavInboxIcon, defaultView: 'inbox', views: ['inbox'] },
  // Strategy and the Domains with their Objects and Elements. Strategy opens
  // first, the sidebar's top row; Phase stays routable but is not in the nav.
  workspace: { label: 'Workspace', icon: NavStrategyModeIcon, defaultView: 'strategy',
    views: ['strategy', 'automation', 'phase', 'objects', 'domain-elements', 'domains', 'domain-overview'] },
  reviews:   { label: 'Reviews',   icon: GitCompare, defaultView: 'reviews', views: ['reviews'] },
  notebook:  { label: 'Notebook',  icon: NavNoteIcon, defaultView: 'note', views: ['note'] },
  tables:    { label: 'Table',     icon: NavTableIcon, defaultView: 'tables', views: ['tables'] },
  files:     { label: 'Artifacts', icon: NavFilesIcon, defaultView: 'files', views: ['files'] },
  slides:    { label: 'Slides',    icon: NavSlidesIcon, defaultView: 'slides', views: ['slides'] },
  // People holds the team's load too ('workload' still opens it).
  team:      { label: 'People',    icon: NavTeamsIcon, defaultView: 'team', views: ['team', 'workload'] },
  calendar:  { label: 'Calendar',  icon: NavCalendarIcon, defaultView: 'calendar', views: ['calendar', 'schedule'] },
  audit:     { label: 'Audit',     icon: NavAuditIcon, defaultView: 'audit', views: ['audit'] },
  ai:        { label: 'AI',        icon: NavAiIcon, defaultView: 'ai', views: ['ai'] },
};

/** Navigation, highlighting and the launcher read the same mode definitions. */
export function railModeOf(view: string): RailMode | null {
  return (Object.keys(MODE_META) as RailMode[]).find(mode =>
    MODE_META[mode].views.some(id => id === view)) ?? null;
}

/** The document tools, opened from Artifacts (and the command palette). */
export const BAR_TOOLS: RailMode[] = ['notebook', 'slides'];

/** The tools the command palette offers besides the document tools. */
export const TOOL_MODES: RailMode[] = ['tables', 'files', 'team', 'audit', 'reviews'];
