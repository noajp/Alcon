'use client';

import { useSyncExternalStore } from 'react';
import type { Worker } from '@/types/database';
import type { WorkloadTeamSummary } from './workloadModel';

// The Workload sidebar (who, and in which Domains) and the main surface (the
// chart and the plan) do not share a parent below the shell, so what they both
// read lives here — the same module-store shape as the Calendar's. The zoom is
// kept in localStorage because it is a preference; the Domain choice is kept
// for the page, scoped to the Space it was made in.
//
// The main surface computes every Worker's load and publishes the result. The
// sidebar reads it rather than computing it again, so the list on the left
// and the chart on the right can never disagree about who is over.

export type WorkloadRange = '2w' | 'month' | 'quarter';

export const WORKLOAD_RANGES: Record<WorkloadRange, { days: number; past: number; dayW: number; step: number }> = {
  '2w': { days: 14, past: 2, dayW: 48, step: 7 },
  month: { days: 31, past: 6, dayW: 22, step: 7 },
  quarter: { days: 91, past: 7, dayW: 10, step: 28 },
};

/** One Worker's row as the sidebar shows it. */
export interface WorkloadPerson {
  worker: Worker;
  utilization: number | null;
  overDays: number;
  awayDays: number;
  /** Open Elements due on a day this Worker has no hours, from today on. */
  dueAway: number;
}

export interface WorkloadPublished {
  people: WorkloadPerson[];
  team: WorkloadTeamSummary;
  proposals: number;
}

type State = {
  range: WorkloadRange;
  anchor: number;
  domains: { contextKey: string; ids: string[] | null };
  planOpen: boolean;
  published: WorkloadPublished | null;
};

const RANGE_KEY = 'alcon:workload-range';

function readRange(): WorkloadRange {
  if (typeof window === 'undefined') return 'month';
  try {
    const saved = window.localStorage.getItem(RANGE_KEY);
    return saved === '2w' || saved === 'quarter' || saved === 'month' ? saved : 'month';
  } catch {
    return 'month';
  }
}

let state: State | null = null;
const listeners = new Set<() => void>();

function get(): State {
  if (state === null) {
    state = { range: readRange(), anchor: 0, domains: { contextKey: '', ids: null }, planOpen: false, published: null };
  }
  return state;
}

const SERVER: State = { range: 'month', anchor: 0, domains: { contextKey: '', ids: null }, planOpen: false, published: null };

function set(patch: Partial<State>) {
  state = { ...get(), ...patch };
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function useWorkloadState(): State {
  return useSyncExternalStore(subscribe, get, () => SERVER);
}

export function useWorkloadRange(): { range: WorkloadRange; anchor: number } {
  const s = useWorkloadState();
  return { range: s.range, anchor: s.anchor };
}

export function setWorkloadRange(range: WorkloadRange) {
  try { window.localStorage.setItem(RANGE_KEY, range); } catch { /* storage may be disabled */ }
  set({ range, anchor: 0 });
}

export function shiftWorkloadAnchor(by: number | null) {
  set({ anchor: by === null ? 0 : get().anchor + by });
}

/** The Domain filter chosen in this Space; null follows every Domain. */
export function useWorkloadDomainChoice(contextKey: string): string[] | null {
  const { domains } = useWorkloadState();
  return domains.contextKey === contextKey ? domains.ids : null;
}

export function setWorkloadDomainChoice(contextKey: string, ids: string[] | null) {
  set({ domains: { contextKey, ids } });
}

export function useWorkloadPlanOpen(): boolean {
  return useWorkloadState().planOpen;
}

export function setWorkloadPlanOpen(open: boolean) {
  if (get().planOpen !== open) set({ planOpen: open });
}

export function useWorkloadPublished(): WorkloadPublished | null {
  return useWorkloadState().published;
}

/** Publishes only when something the sidebar shows changed, so a re-render of
 *  the chart does not re-render the sidebar. */
export function publishWorkload(next: WorkloadPublished | null) {
  const current = get().published;
  if (signature(current) === signature(next)) return;
  set({ published: next });
}

function signature(p: WorkloadPublished | null): string {
  if (!p) return '';
  const pct = (n: number | null) => (n === null ? '-' : Math.round(n * 1000));
  return [
    p.proposals,
    pct(p.team.utilization), p.team.overloadedPeople, p.team.overDays, Math.round(p.team.hours), pct(p.team.aiShare),
    ...p.people.map((x) => `${x.worker.id}|${x.worker.name}|${x.worker.avatar_url ?? ''}|${x.worker.type}|${pct(x.utilization)}|${x.overDays}|${x.awayDays}|${x.dueAway}`),
  ].join('\n');
}
