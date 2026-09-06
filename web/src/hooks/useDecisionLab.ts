'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ACTIVE_SPACE_CHANGE_EVENT, getActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { selectIn } from '@/hooks/chunkedIn';
import { readAllPages as readDecisionLabPages, type CountedRows } from '@/hooks/readAllPages';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import { normalizeDirection } from '@/types/database';
import type {
  AlconObject, Element, ElementAssignee, ElementEdge, ElementObject,
  ElementWithDetails, Strategy, StrategyChild, StrategyObject, Worker, WorkerAvailability,
} from '@/types/database';

export { readAllPages as readDecisionLabPages } from '@/hooks/readAllPages';

export interface DecisionLabData {
  elements: ElementWithDetails[];
  workers: Worker[];
  availability: WorkerAvailability[];
  edges: ElementEdge[];
  scopeElementIds: string[];
  objects: AlconObject[];
  initiativeName: string;
  initiativeOwnerId: string | null;
  readAt: string;
}

const EMPTY: DecisionLabData = {
  elements: [], workers: [], availability: [], edges: [], scopeElementIds: [],
  objects: [], initiativeName: '', initiativeOwnerId: '', readAt: '',
};

function readIds<Row>(
  label: string,
  ids: readonly string[],
  run: (chunk: string[], from: number, to: number) => PromiseLike<CountedRows<Row>>,
  identity: (row: Row) => string,
): Promise<Row[]> {
  return selectIn<Row>(ids, async (chunk) => ({
    data: await readDecisionLabPages(label, (from, to) => run(chunk, from, to), identity),
    error: null,
  }));
}

const rowId = (row: { id: string }) => row.id;
const uniqueRows = <Row extends { id: string }>(rows: Row[]) => [...new Map(rows.map((row) => [row.id, row])).values()];

/** Only the authenticated browser client is used. RLS decides visibility;
 * explicit Domain/Space membership decides which visible rows belong to this
 * forecast. In particular, a visible dependency in another Space is kept as an
 * opaque edge endpoint, never hydrated into this Space's workload. */
export async function fetchDecisionLabData(
  initiativeId: string,
  spaceId: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<DecisionLabData> {
  const [{ data: initiative, error: initiativeError }, domains] = await Promise.all([
    supabase.from('strategies').select('*').eq('id', initiativeId).abortSignal(signal).single<Strategy>(),
    readDecisionLabPages<{ id: string }>('Space Domains', (from, to) => supabase
      .from('domains').select('id', { count: 'exact' }).eq('activity_space_id', spaceId)
      .order('id').range(from, to).abortSignal(signal), rowId),
  ]);
  if (initiativeError) throw new Error(`Unable to read Initiative: ${initiativeError.message}`);
  if (!initiative) throw new Error('This Initiative is no longer visible.');

  // Follow only visible child Initiatives. A Set also terminates malformed
  // cycles and collapses a child reached through multiple parents.
  const initiativeIds = new Set([initiativeId]);
  let frontier = [initiativeId];
  while (frontier.length > 0) {
    const nesting = await readIds<StrategyChild>('Initiative children', frontier, (chunk, from, to) => supabase
      .from('strategy_children').select('*', { count: 'exact' }).in('parent_strategy_id', chunk)
      .order('parent_strategy_id').order('child_strategy_id').range(from, to).abortSignal(signal),
    (row) => `${row.parent_strategy_id}:${row.child_strategy_id}`);
    const unreadIds = [...new Set(nesting.map((row) => row.child_strategy_id))].filter((id) => !initiativeIds.has(id));
    const children = await readIds<{ id: string }>('Child Initiatives', unreadIds, (chunk, from, to) => supabase
      .from('strategies').select('id', { count: 'exact' }).in('id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId);
    frontier = children.map((row) => row.id);
    for (const id of frontier) initiativeIds.add(id);
  }

  const domainIds = domains.map((row) => row.id);
  const [initiativeLinks, objectLinks, directObjects, spaceMembers, domainMembers] = await Promise.all([
    readIds<StrategyObject>('Initiative Objects', [...initiativeIds], (chunk, from, to) => supabase
      .from('strategy_objects').select('*', { count: 'exact' }).in('strategy_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<{ object_id: string; domain_id: string }>('Object Domains', domainIds, (chunk, from, to) => supabase
      .from('object_domains').select('object_id, domain_id', { count: 'exact' }).in('domain_id', chunk)
      .order('object_id').order('domain_id').range(from, to).abortSignal(signal),
    (row) => `${row.object_id}:${row.domain_id}`),
    readIds<AlconObject>('Space Objects', domainIds, (chunk, from, to) => supabase
      .from('objects').select('*', { count: 'exact' }).in('domain_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readDecisionLabPages<{ user_id: string }>('Space members', (from, to) => supabase
      .from('activity_space_members').select('user_id', { count: 'exact' }).eq('activity_space_id', spaceId)
      .order('user_id').range(from, to).abortSignal(signal), (row) => row.user_id),
    readIds<{ user_id: string; domain_id: string }>('Domain members', domainIds, (chunk, from, to) => supabase
      .from('domain_members').select('user_id, domain_id', { count: 'exact' }).in('domain_id', chunk)
      .order('domain_id').order('user_id').range(from, to).abortSignal(signal),
    (row) => `${row.domain_id}:${row.user_id}`),
  ]);

  const directObjectIds = new Set(directObjects.map((row) => row.id));
  const linkedObjects = await readIds<AlconObject>('Linked Space Objects',
    objectLinks.map((row) => row.object_id).filter((id) => !directObjectIds.has(id)), (chunk, from, to) => supabase
      .from('objects').select('*', { count: 'exact' }).in('id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId);
  const objects = uniqueRows([...directObjects, ...linkedObjects]);
  const objectIds = objects.map((row) => row.id);
  const objectSet = new Set(objectIds);
  const scopeObjectIds = new Set(initiativeLinks.map((row) => row.object_id).filter((id) => objectSet.has(id)));
  if (initiativeLinks.length > 0 && scopeObjectIds.size === 0) {
    throw new Error('This Initiative has no visible Objects in the current Space. Switch to its Space to forecast.');
  }

  const [elementHomes, directElements, memberWorkers, objectWorkers] = await Promise.all([
    readIds<ElementObject>('Element Objects', objectIds, (chunk, from, to) => supabase
      .from('element_objects').select('*', { count: 'exact' }).in('object_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<Element>('Space Elements', objectIds, (chunk, from, to) => supabase
      .from('elements').select('*', { count: 'exact' }).in('object_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<Worker>('Space Workers', [...spaceMembers, ...domainMembers].map((row) => row.user_id), (chunk, from, to) => supabase
      .from('workers').select('*', { count: 'exact' }).in('user_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<Worker>('Object Workers', objectIds, (chunk, from, to) => supabase
      .from('workers').select('*', { count: 'exact' }).in('object_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
  ]);
  const directElementIds = new Set(directElements.map((row) => row.id));
  const linkedElements = await readIds<Element>('Linked Space Elements',
    elementHomes.map((row) => row.element_id).filter((id) => !directElementIds.has(id)), (chunk, from, to) => supabase
      .from('elements').select('*', { count: 'exact' }).in('id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId);
  const elementRows = uniqueRows([...directElements, ...linkedElements]);
  const elementIds = elementRows.map((row) => row.id);
  const [assignees, incoming, outgoing] = await Promise.all([
    readIds<ElementAssignee>('Element assignees', elementIds, (chunk, from, to) => supabase
      .from('element_assignees').select('*', { count: 'exact' }).in('element_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    // from = prerequisite; to = the Element that waits for it. Do not filter
    // both endpoints to the Space, which would erase invisible prerequisites.
    readIds<ElementEdge>('Incoming dependencies', elementIds, (chunk, from, to) => supabase
      .from('element_edges').select('*', { count: 'exact' }).eq('edge_type', 'depends_on').in('to_element', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<ElementEdge>('Outgoing dependencies', elementIds, (chunk, from, to) => supabase
      .from('element_edges').select('*', { count: 'exact' }).eq('edge_type', 'depends_on').in('from_element', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
  ]);
  const knownWorkers = uniqueRows([
    ...memberWorkers.filter((row) => row.object_id === null || objectSet.has(row.object_id)),
    ...objectWorkers,
  ]);
  const knownWorkerIds = new Set(knownWorkers.map((row) => row.id));
  const assignedWorkers = await readIds<Worker>('Assigned Workers', assignees.map((row) => row.worker_id)
    .filter((id) => !knownWorkerIds.has(id)), (chunk, from, to) => supabase
      .from('workers').select('*', { count: 'exact' }).in('id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId);
  // Unscoped AI Workers have no Space identity. They join this roster only
  // through a visible Object or assignment, rather than leaking other Spaces.
  const workers = uniqueRows([...knownWorkers, ...assignedWorkers]);
  const availability = await readIds<WorkerAvailability>('Worker availability', workers.map((row) => row.id),
    (chunk, from, to) => supabase.from('worker_availability').select('*', { count: 'exact' }).in('worker_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId);

  const workerById = new Map(workers.map((row) => [row.id, row]));
  const homesByElement = new Map<string, Set<string>>();
  for (const row of elementHomes) {
    const homes = homesByElement.get(row.element_id) ?? new Set<string>();
    homes.add(row.object_id);
    homesByElement.set(row.element_id, homes);
  }
  const assigneesByElement = new Map<string, ElementAssignee[]>();
  for (const row of assignees) {
    const group = assigneesByElement.get(row.element_id) ?? [];
    group.push(row);
    assigneesByElement.set(row.element_id, group);
  }
  const elements = elementRows.map((row): ElementWithDetails => {
    const homes = homesByElement.get(row.id) ?? new Set<string>();
    if (row.object_id && objectSet.has(row.object_id)) homes.add(row.object_id);
    return {
      ...row,
      direction: normalizeDirection(row.direction),
      objectIds: [...homes],
      isMultiHomed: homes.size > 1,
      assignees: (assigneesByElement.get(row.id) ?? []).map((assignee) => ({
        ...assignee, worker: workerById.get(assignee.worker_id),
      })),
    };
  });
  return {
    elements, workers, availability, edges: uniqueRows([...incoming, ...outgoing]), objects,
    scopeElementIds: elements.filter((row) => row.objectIds?.some((id) => scopeObjectIds.has(id))).map((row) => row.id),
    initiativeName: initiative.name, initiativeOwnerId: initiative.created_by, readAt: new Date().toISOString(),
  };
}

function subscribeSpace(onChange: () => void) {
  window.addEventListener(ACTIVE_SPACE_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(ACTIVE_SPACE_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useDecisionLab(initiativeId: string | null) {
  const userId = useCurrentUserId();
  const spaceId = useSyncExternalStore(subscribeSpace, getActiveSpaceId, () => null);
  const enabled = Boolean(userId && spaceId && initiativeId);
  const query = useQuery({
    queryKey: ['decisionLab', userId, spaceId, initiativeId],
    queryFn: ({ signal }) => fetchDecisionLabData(initiativeId!, spaceId!, signal),
    enabled,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
    // No placeholderData: results from another user/Space/Initiative must
    // never survive a context switch. This root is not in the persisted cache.
  });
  const refetch = query.refetch;
  const refresh = useCallback(async (): Promise<DecisionLabData> => {
    if (!enabled || getActiveSpaceId() !== spaceId) throw new Error('Select a Space and Initiative before forecasting.');
    const result = await refetch({ throwOnError: true, cancelRefetch: true });
    if (getActiveSpaceId() !== spaceId) throw new Error('The active Space changed. Run the forecast again.');
    if (!result.data) throw new Error('Decision Lab data is unavailable.');
    return result.data;
  }, [enabled, spaceId, refetch]);
  return {
    canRecord: Boolean(enabled && query.data?.initiativeOwnerId === userId),
    data: enabled ? query.data ?? EMPTY : EMPTY,
    contextKey: JSON.stringify(['decisionLab', userId, spaceId, initiativeId]),
    enabled,
    loading: enabled && query.isPending,
    refreshing: enabled && query.isFetching && !query.isPending,
    error: enabled ? query.error : null,
    refresh,
  };
}
