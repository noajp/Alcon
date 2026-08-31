'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchStrategyElements } from '@/hooks/useSupabase';
import {
  computeCampaignRisk,
  type CampaignRiskOptions,
  type CampaignRiskReport,
  type RiskElement,
  type RiskObject,
} from '@/alcon/element/actions/campaignRiskModel';

// =============================================================
// The read side of <CampaignRisk>. Everything a Campaign's cross-section
// needs, in one place, so no other surface has to grow a column for it.
//
// Deliberately not a new query in `hooks/useSupabase.ts`: the Object scope
// resolution and the Element fetch already exist there (`fetchStrategyElements`
// is what the Workload surface uses), and the only genuinely new read is the
// progress-comment heartbeat.
// =============================================================

export interface CampaignRiskState {
  report: CampaignRiskReport | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Newest progress comment per Element — the heartbeat `isStalled` reads. */
async function fetchLastProgressAt(elementIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (elementIds.length === 0) return out;
  const { data, error } = await supabase
    .from('element_comments')
    .select('element_id, created_at')
    .in('element_id', elementIds);
  if (error) throw error;
  for (const row of (data ?? []) as { element_id: string; created_at: string }[]) {
    const t = Date.parse(row.created_at);
    if (Number.isNaN(t)) continue;
    const seen = out.get(row.element_id);
    if (seen === undefined || t > seen) out.set(row.element_id, t);
  }
  return out;
}

async function loadCampaignRisk(
  campaignId: string,
  options: CampaignRiskOptions,
): Promise<CampaignRiskReport> {
  const { data: links, error: linkErr } = await supabase
    .from('strategy_objects')
    .select('object_id')
    .eq('strategy_id', campaignId);
  if (linkErr) throw linkErr;

  const objectIds = ((links ?? []) as { object_id: string }[]).map((l) => l.object_id);
  if (objectIds.length === 0) return computeCampaignRisk([], [], Date.now(), options);

  const { elements, objects } = await fetchStrategyElements({ domainIds: [], objectIds });
  const heartbeats = await fetchLastProgressAt(elements.map((el) => el.id));

  // The Campaign's Object scope, in the order the Campaign links them —
  // `fetchStrategyElements` returns Objects in whatever order Postgres hands
  // them back, and a findings list that reshuffles between refreshes is
  // unreadable.
  const byId = new Map(objects.map((o) => [o.id, o]));
  const scope: RiskObject[] = objectIds
    .map((id) => byId.get(id))
    .filter((o): o is NonNullable<typeof o> => o !== undefined)
    .map((o) => ({ id: o.id, name: o.name, domainId: o.domain_id }));

  const rows: RiskElement[] = elements.map((el) => ({
    id: el.id,
    display_id: el.display_id,
    title: el.title,
    status: el.status,
    due_date: el.due_date,
    updated_at: el.updated_at,
    objectIds: el.objectIds ?? (el.object_id ? [el.object_id] : []),
    assignees: (el.assignees ?? [])
      .map((a) => a.worker)
      .filter((w): w is NonNullable<typeof w> => !!w)
      .map((w) => ({ id: w.id, name: w.name })),
    lastProgressAt: heartbeats.get(el.id) ?? null,
  }));

  return computeCampaignRisk(scope, rows, Date.now(), options);
}

export function useCampaignRisk(
  campaignId: string | null,
  options: CampaignRiskOptions = {},
): CampaignRiskState {
  const { stallMinutes, idleHours, concentrationThreshold } = options;

  const query = useQuery({
    queryKey: ['campaignRisk', campaignId, stallMinutes, idleHours, concentrationThreshold],
    queryFn: () =>
      loadCampaignRisk(campaignId as string, { stallMinutes, idleHours, concentrationThreshold }),
    enabled: campaignId !== null,
    // Every number in the report is measured against the clock at the moment
    // it was computed, so a cached one ages into a lie — "quiet for 3h" served
    // from yesterday's cache reads as fresh. Refetch on every mount, and keep
    // it out of the 24h persisted cache the other queries live in.
    staleTime: 0,
    gcTime: 60_000,
  });

  return {
    report: query.data ?? null,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
}
