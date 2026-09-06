'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchStrategyElements } from '@/hooks/useSupabase';
import { fetchLastProgressAt, toRiskElements } from './useInitiativeRisk';
import { computeInitiativeHealth, type InitiativeHealth } from './initiativeHealthModel';
import type { StrategyWithObjects } from '@/types/database';

// =============================================================
// Health for every Initiative in a list, from one read.
//
// The Initiative page fetches its own Elements when opened. A list of twelve
// Initiatives must not open twelve of those: it takes the union of their
// Object scopes, fetches the Elements once (the same `fetchStrategyElements`
// the page and the Workload surface use), reads the progress heartbeat once,
// and partitions per Initiative in memory. An Object in two Initiatives is
// fetched once and counted in both — the same shape as an Element with two
// assignees.
// =============================================================

export interface InitiativeHealthState {
  byId: Map<string, InitiativeHealth>;
  loading: boolean;
  error: Error | null;
}

const EMPTY = new Map<string, InitiativeHealth>();

async function loadHealth(strategies: StrategyWithObjects[]): Promise<Map<string, InitiativeHealth>> {
  const now = Date.now();
  const union = Array.from(new Set(strategies.flatMap((s) => s.objectIds)));
  if (union.length === 0) {
    return new Map(strategies.map((s) => [s.id, computeInitiativeHealth(s.objectIds, [], now)]));
  }
  const { elements } = await fetchStrategyElements({ domainIds: [], objectIds: union });
  const heartbeats = await fetchLastProgressAt(elements.map((el) => el.id));
  const rows = toRiskElements(elements, heartbeats);
  return new Map(strategies.map((s) => [s.id, computeInitiativeHealth(s.objectIds, rows, now)]));
}

export function useInitiativeHealth(strategies: StrategyWithObjects[]): InitiativeHealthState {
  // The key is the scope, not the Initiative list's identity: two renders
  // with the same Objects share one read.
  const scopeKey = strategies
    .map((s) => `${s.id}:${[...s.objectIds].sort().join(',')}`)
    .sort()
    .join('|');
  const query = useQuery({
    queryKey: ['initiativeHealth', scopeKey],
    queryFn: () => loadHealth(strategies),
    enabled: strategies.length > 0,
    // Measured against the clock at compute time, like the risk report — a
    // cached "moved 2h ago" ages into a lie. Refetch on mount, don't persist.
    staleTime: 0,
    gcTime: 60_000,
  });
  return {
    byId: query.data ?? EMPTY,
    loading: query.isPending && strategies.length > 0,
    error: (query.error as Error | null) ?? null,
  };
}
