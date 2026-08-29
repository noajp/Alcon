'use client';

import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import {
  NavHomeIcon,
  NavNoteIcon,
  NavTableIcon,
  NavTeamsIcon,
  NavWorkloadIcon,
  NavStrategyModeIcon,
  NavExecutionModeIcon,
} from '@/shell/sidebar/NavIcons';

// The ModeRail's top-level modes, and which of them are permanent.
//
// Home / Strategy / Execution are the spine: the personal slice, the Ends and
// Ways, and the employment of means. They are always on the rail and cannot be
// removed. Everything else is an app the user adds from the launcher, so the
// rail stays as short as each person's actual work.
export type RailMode = 'home' | 'strategy' | 'execution' | 'workload' | 'notebook' | 'tables' | 'team';

export interface ModeMeta {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
}

export const MODE_META: Record<RailMode, ModeMeta> = {
  home:      { label: 'Home',      icon: NavHomeIcon },
  strategy:  { label: 'Strategy',  icon: NavStrategyModeIcon },
  execution: { label: 'Execution', icon: NavExecutionModeIcon },
  workload:  { label: 'Workload',  icon: NavWorkloadIcon },
  notebook:  { label: 'Notebook',  icon: NavNoteIcon },
  tables:    { label: 'Table',     icon: NavTableIcon },
  team:      { label: 'Team',      icon: NavTeamsIcon },
};

export const CORE_MODES: RailMode[] = ['home', 'strategy', 'execution'];

// The launcher's catalog. Tools are the surfaces that stand outside the
// Ends → Means cascade and serve any layer. Sustainment is what keeps the
// means able to work at all.
export const APP_GROUPS: { title: string; apps: RailMode[] }[] = [
  { title: 'Tools', apps: ['notebook', 'tables', 'team'] },
  { title: 'Sustainment', apps: ['workload'] },
];

const APP_MODES: RailMode[] = APP_GROUPS.flatMap((g) => g.apps);

export const isAppMode = (mode: RailMode): boolean => APP_MODES.includes(mode);

const RAIL_APPS_KEY = 'alcon:railApps';
const RAIL_APPS_CHANGE_EVENT = 'alcon:rail-apps-change';

function readRailApps(): RailMode[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RAIL_APPS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    // Always catalog order, so the rail never depends on what was added first.
    return APP_MODES.filter((m) => raw.includes(m));
  } catch {
    return [];
  }
}

/** The apps this user has added to the rail, plus the setter that toggles one. */
export function useRailApps(): [RailMode[], (mode: RailMode, added: boolean) => void] {
  const [apps, setApps] = useState<RailMode[]>(readRailApps);

  useEffect(() => {
    const sync = () => setApps(readRailApps());
    window.addEventListener(RAIL_APPS_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync); // another tab wrote the key
    return () => {
      window.removeEventListener(RAIL_APPS_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setApp = useCallback((mode: RailMode, added: boolean) => {
    const current = readRailApps();
    const next = APP_MODES.filter((m) => (m === mode ? added : current.includes(m)));
    window.localStorage.setItem(RAIL_APPS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RAIL_APPS_CHANGE_EVENT));
  }, []);

  return [apps, setApp];
}
