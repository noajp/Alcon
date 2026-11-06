'use client';

import { useSyncExternalStore } from 'react';

// The Workload surface's view state — the zoom, the Domains shown and
// whether the plan is open — kept outside the chart so it survives a remount,
// the same module-store shape as the Calendar's. The zoom is kept in
// localStorage because it is a preference; the Domain choice is kept for the
// page, scoped to the Space it was made in.

export type WorkloadRange = '2w' | 'month' | 'quarter';

export const WORKLOAD_RANGES: Record<WorkloadRange, { days: number; past: number; dayW: number; step: number }> = {
  '2w': { days: 14, past: 2, dayW: 48, step: 7 },
  month: { days: 31, past: 6, dayW: 22, step: 7 },
  quarter: { days: 91, past: 7, dayW: 10, step: 28 },
};

type State = {
  range: WorkloadRange;
  anchor: number;
  domains: { contextKey: string; ids: string[] | null };
  planOpen: boolean;
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
    state = { range: readRange(), anchor: 0, domains: { contextKey: '', ids: null }, planOpen: false };
  }
  return state;
}

const SERVER: State = { range: 'month', anchor: 0, domains: { contextKey: '', ids: null }, planOpen: false };

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

