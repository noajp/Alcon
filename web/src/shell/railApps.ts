'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type React from 'react';
import {
  NavHomeIcon,
  NavNoteIcon,
  NavTableIcon,
  NavTeamsIcon,
  NavWorkloadIcon,
  NavStrategyModeIcon,
  NavExecutionModeIcon,
  NavCalendarIcon,
} from '@/shell/sidebar/NavIcons';
import type { ViewId } from '@/shell/viewRegistry';

// The ModeRail's top-level modes, and which of them are permanent.
//
// Home / Strategy / Execution are the spine: the personal slice, the strategy
// (Initiatives), and the fighting (Element → Object → Domain). They are always on
// the rail and cannot be removed. Everything else is an app the user adds from the launcher, so the
// rail stays as short as each person's actual work.
export type RailMode = 'home' | 'strategy' | 'execution' | 'workload' | 'notebook' | 'tables' | 'team' | 'calendar';

export interface ModeMeta {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  defaultView: ViewId;
  views: readonly ViewId[];
}

export const MODE_META: Record<RailMode, ModeMeta> = {
  home:      { label: 'Home',      icon: NavHomeIcon, defaultView: 'inbox', views: ['home', 'inbox', 'calendar', 'my-elements', 'profile'] },
  strategy:  { label: 'Strategy',  icon: NavStrategyModeIcon, defaultView: 'strategy', views: ['strategy', 'phase', 'timeline'] },
  execution: { label: 'Execution', icon: NavExecutionModeIcon, defaultView: 'objects', views: ['objects', 'domain-elements', 'domains'] },
  workload:  { label: 'Workload',  icon: NavWorkloadIcon, defaultView: 'workload', views: ['workload'] },
  notebook:  { label: 'Notebook',  icon: NavNoteIcon, defaultView: 'note', views: ['note'] },
  tables:    { label: 'Table',     icon: NavTableIcon, defaultView: 'tables', views: ['tables'] },
  team:      { label: 'Team',      icon: NavTeamsIcon, defaultView: 'team', views: ['team'] },
  calendar:  { label: 'Calendar',  icon: NavCalendarIcon, defaultView: 'schedule', views: ['schedule'] },
};

/** Navigation, highlighting and the launcher read the same mode definitions. */
export function railModeOf(view: string): RailMode | null {
  return (Object.keys(MODE_META) as RailMode[]).find(mode =>
    MODE_META[mode].views.some(id => id === view)) ?? null;
}

export const CORE_MODES: RailMode[] = ['home', 'strategy', 'execution'];

// The launcher's catalog. Everything here is Sustainment — the tools of work
// that keep the people doing the fighting able to keep going. The two groups
// are a display split only: Tools serve any surface, Workload watches capacity.
export const APP_GROUPS: { title: string; apps: RailMode[] }[] = [
  { title: 'Tools', apps: ['notebook', 'tables', 'team'] },
  { title: 'Sustainment', apps: ['workload', 'calendar'] },
];

const APP_MODES: RailMode[] = APP_GROUPS.flatMap((g) => g.apps);

export const isAppMode = (mode: RailMode): boolean => APP_MODES.includes(mode);

const RAIL_APPS_KEY = 'alcon:railApps';
const RAIL_APPS_CHANGE_EVENT = 'alcon:rail-apps-change';

function readRailApps(): RailMode[] {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RAIL_APPS_KEY) ?? '[]');
    if (!Array.isArray(raw)) return EMPTY;
    // Always catalog order, so the rail never depends on what was added first.
    return APP_MODES.filter((m) => raw.includes(m));
  } catch {
    return EMPTY;
  }
}

// ─── Shared store ─────────────────────────────────────────────────────────
// The rail's added apps live in localStorage, which makes them an external
// store, and reading one during render is what produced the hydration
// mismatch: the server has no storage and renders an empty rail, while the
// client's first render already knows the user added Workload. React answers
// this with `getServerSnapshot`, which it uses for the server render AND the
// hydrating one, then re-renders from the client snapshot once mounted — the
// same shape `useListColumns` documents.
//
// The snapshot is cached because `getSnapshot` must return the same reference
// until something actually changes; `readRailApps` builds a new array every
// call, and returning that directly would spin.

const EMPTY: RailMode[] = Object.freeze([]) as unknown as RailMode[];

let snapshot: RailMode[] | null = null;
const listeners = new Set<() => void>();
let wired = false;

function getSnapshot(): RailMode[] {
  if (snapshot === null) snapshot = readRailApps();
  return snapshot;
}

function getServerSnapshot(): RailMode[] {
  return EMPTY;
}

function invalidate() {
  snapshot = readRailApps();
  listeners.forEach((fn) => fn());
}

/** `storage` fires for every key another tab writes — including the boards,
 *  which write on each drag. A null key means the store was cleared, which
 *  does concern us. */
function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== RAIL_APPS_KEY) return;
  invalidate();
}

function subscribe(listener: () => void): () => void {
  if (!wired) {
    wired = true;
    window.addEventListener(RAIL_APPS_CHANGE_EVENT, invalidate);
    window.addEventListener('storage', onStorage); // another tab wrote the key
  }
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The apps this user has added to the rail, plus the setter that toggles one. */
export function useRailApps(): [RailMode[], (mode: RailMode, added: boolean) => void] {
  const apps = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setApp = useCallback((mode: RailMode, added: boolean) => {
    const current = readRailApps();
    const next = APP_MODES.filter((m) => (m === mode ? added : current.includes(m)));
    window.localStorage.setItem(RAIL_APPS_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RAIL_APPS_CHANGE_EVENT));
  }, []);

  return [apps, setApp];
}
