'use client';

import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { getQueryClient } from '@/lib/queryClient';
import {
  getElementEdges,
  fetchElementCustomColumnsWithValues,
  fetchElementComments,
  type ElementEdgeWithElement,
  type CustomColumnWithValues,
} from '@/hooks/useSupabase';
import type { ElementReaction } from '@/types/database';

// Per-Element detail data, keyed by Element id in the shared query cache.
//
// One key per (Element, facet): a reopen paints from the cache while the
// refresh runs behind it, concurrent readers share one request, and a row can
// prefetch its detail on hover so the click lands on warm data (Linear's
// "already loaded" feel). Writers that change a facet's rows call
// invalidateElementDetail (hooks/useSupabase) so the cache never outlives the
// truth.

const elementKey = (id: string, facet: string, ...rest: (string | null)[]) =>
  ['element', id, facet, ...rest] as const;

const NO_REACTIONS: ElementReaction[] = [];
const NO_EDGES: { incoming: ElementEdgeWithElement[]; outgoing: ElementEdgeWithElement[] } = { incoming: [], outgoing: [] };
const NO_OBJECTS: { id: string; name: string }[] = [];
const NO_COLUMNS: CustomColumnWithValues[] = [];

async function fetchReactions(elementId: string): Promise<ElementReaction[]> {
  const { data, error } = await supabase
    .from('element_reactions')
    .select('*')
    .eq('element_id', elementId);
  if (error) throw error;
  return (data ?? []) as ElementReaction[];
}

// Member Objects — every Object this Element is homed under (primary FK +
// element_objects multi-homing). Rows hidden by RLS drop out.
async function fetchMemberObjects(elementId: string, primaryObjectId: string | null) {
  const ids = new Set<string>();
  if (primaryObjectId) ids.add(primaryObjectId);
  const { data: links, error } = await supabase
    .from('element_objects')
    .select('object_id')
    .eq('element_id', elementId);
  if (error) throw error;
  for (const l of links ?? []) if (l.object_id) ids.add(l.object_id as string);
  if (ids.size === 0) return NO_OBJECTS;
  const { data: objs, error: oErr } = await supabase
    .from('objects')
    .select('id, name')
    .in('id', Array.from(ids));
  if (oErr) throw oErr;
  return (objs ?? []).map((o) => ({ id: o.id as string, name: (o.name as string) ?? 'Untitled' }));
}

export function useElementReactions(elementId: string) {
  const qc = useQueryClient();
  const key = useMemo(() => elementKey(elementId, 'reactions'), [elementId]);
  const query = useQuery({ queryKey: key, queryFn: () => fetchReactions(elementId) });
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: key }), [qc, key]);
  return { reactions: query.data ?? NO_REACTIONS, refresh };
}

export function useElementEdges(elementId: string) {
  const query = useQuery({
    queryKey: elementKey(elementId, 'edges'),
    queryFn: () => getElementEdges(elementId),
  });
  return query.data ?? NO_EDGES;
}

export function useElementMemberObjects(elementId: string, primaryObjectId: string | null) {
  const query = useQuery({
    queryKey: elementKey(elementId, 'member-objects', primaryObjectId),
    queryFn: () => fetchMemberObjects(elementId, primaryObjectId),
  });
  return query.data ?? NO_OBJECTS;
}

export function useElementCustomColumns(elementId: string, primaryObjectId: string | null) {
  const qc = useQueryClient();
  const key = useMemo(() => elementKey(elementId, 'custom-columns', primaryObjectId), [elementId, primaryObjectId]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchElementCustomColumnsWithValues(elementId, primaryObjectId),
  });
  const reload = useCallback(() => { void qc.invalidateQueries({ queryKey: key }); }, [qc, key]);
  return { customColumns: query.data ?? NO_COLUMNS, reload };
}

const elementCommentsKey = (elementId: string) => elementKey(elementId, 'comments');

/** Warm the detail facets for an Element before it is opened (row hover).
 *  Cheap when already cached: prefetchQuery skips fresh entries. */
function prefetchElementDetail(
  el: { id: string; object_id: string | null },
  client: QueryClient = getQueryClient(),
): void {
  const stale = { staleTime: 30_000 };
  void client.prefetchQuery({ queryKey: elementKey(el.id, 'reactions'), queryFn: () => fetchReactions(el.id), ...stale });
  void client.prefetchQuery({ queryKey: elementKey(el.id, 'edges'), queryFn: () => getElementEdges(el.id), ...stale });
  void client.prefetchQuery({ queryKey: elementKey(el.id, 'member-objects', el.object_id), queryFn: () => fetchMemberObjects(el.id, el.object_id), ...stale });
  void client.prefetchQuery({ queryKey: elementKey(el.id, 'custom-columns', el.object_id), queryFn: () => fetchElementCustomColumnsWithValues(el.id, el.object_id), ...stale });
  void client.prefetchQuery({ queryKey: elementCommentsKey(el.id), queryFn: () => fetchElementComments(el.id), ...stale });
}

// Hover intent: a pointer sweeping down a list crosses every row, and each
// prefetch is 8–11 requests. Only a row the pointer actually rests on for
// HOVER_DWELL_MS gets warmed; leaving the row before that cancels it. One
// pending timer app-wide — a sweep never queues more than one.
const HOVER_DWELL_MS = 150;
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

/** Row `onMouseEnter` handler: schedule a prefetch once the pointer dwells. */
export function scheduleElementDetailPrefetch(el: { id: string; object_id: string | null }): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    prefetchElementDetail(el);
  }, HOVER_DWELL_MS);
}

/** Row `onMouseLeave` handler: the pointer moved on before the dwell. */
export function cancelElementDetailPrefetch(): void {
  if (hoverTimer) clearTimeout(hoverTimer);
  hoverTimer = null;
}
