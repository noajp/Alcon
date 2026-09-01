'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchStrategyElements } from '@/hooks/useSupabase';

// =============================================================
// What a Campaign can point at.
//
// Both binding surfaces — a decision naming what it moved, an assumption naming
// what could falsify it — need the same thing: the Objects this Campaign covers
// and the Elements living inside them, flat, with enough state on each Element
// to say whether it has stopped. So the read is here once rather than in each
// section, and the Object scope resolution is the same `strategy_objects` →
// `fetchStrategyElements` path the risk surface already walks.
//
// Only the Campaign's own scope is offered. A decision can in principle move
// anything in the Space, but a picker over every Element in the workspace is a
// search problem, and the Objects a Campaign links are where its decisions land
// in every case this was built against.
// =============================================================

export interface ScopeObject {
  id: string;
  name: string;
  domainId: string | null;
}

export interface ScopeElement {
  id: string;
  displayId: string | null;
  title: string;
  status: string | null;
  /** `yyyy-MM-dd`, or null. */
  dueDate: string | null;
  /** The first Object this Element is homed in — where a reader is sent to
   *  find it. Elements have no route of their own. */
  objectId: string | null;
  domainId: string | null;
}

export interface CampaignScope {
  objects: ScopeObject[];
  elements: ScopeElement[];
}

const EMPTY: CampaignScope = { objects: [], elements: [] };

async function loadCampaignScope(campaignId: string): Promise<CampaignScope> {
  const { data: links, error } = await supabase
    .from('strategy_objects')
    .select('object_id')
    .eq('strategy_id', campaignId);
  if (error) throw error;

  const objectIds = ((links ?? []) as { object_id: string }[]).map((l) => l.object_id);
  if (objectIds.length === 0) return EMPTY;

  const { elements, objects } = await fetchStrategyElements({ domainIds: [], objectIds });

  // The Campaign's own link order, not Postgres's. A picker that reshuffles
  // between openings makes the reader re-find the row they were reaching for.
  const byId = new Map(objects.map((o) => [o.id, o]));
  const scopeObjects: ScopeObject[] = objectIds
    .map((id) => byId.get(id))
    .filter((o): o is NonNullable<typeof o> => o !== undefined)
    .map((o) => ({ id: o.id, name: o.name, domainId: o.domain_id }));

  const home = new Map(scopeObjects.map((o) => [o.id, o]));

  const scopeElements: ScopeElement[] = elements.map((el) => {
    const homes = el.objectIds ?? (el.object_id ? [el.object_id] : []);
    // Multi-homed Elements are normal, so "which Object" is a choice. The one
    // this Campaign actually covers is the useful answer; falling back to the
    // primary FK keeps the row openable when none of its homes are in scope.
    const inScope = homes.find((id) => home.has(id)) ?? el.object_id ?? null;
    return {
      id: el.id,
      displayId: el.display_id,
      title: el.title,
      status: el.status,
      dueDate: el.due_date,
      objectId: inScope,
      domainId: inScope ? home.get(inScope)?.domainId ?? null : null,
    };
  });

  return { objects: scopeObjects, elements: scopeElements };
}

export function useCampaignScope(campaignId: string | null) {
  const query = useQuery({
    queryKey: ['campaignScope', campaignId],
    queryFn: () => loadCampaignScope(campaignId as string),
    enabled: campaignId !== null,
    // An assumption's mark is read off Element status and due dates, so a
    // cached scope ages into a stale verdict. Same reasoning as the risk
    // surface: refetch on mount, stay out of the persisted cache.
    staleTime: 0,
    gcTime: 60_000,
  });

  return {
    scope: query.data ?? EMPTY,
    loading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: query.refetch,
  };
}
