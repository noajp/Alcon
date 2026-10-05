'use client';

import { useCallback } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { fetchExplorerData } from '@/Function/sync/explorerData';
import type { ExplorerData } from '@/Function/sync/explorerPatch';
import { readAllPages, type CountedRows } from '@/hooks/readAllPages';
import { selectIn } from '@/hooks/chunkedIn';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { AlconObject, Element, ElementAssignee, ElementWithDetails, Worker } from '@/types/database';
import { resolveWorkloadScope, selectWorkloadElements, workloadDomainIds, type WorkloadScope, type WorkloadSelection } from './workloadModel';
import { setWorkloadDomainChoice, useWorkloadDomainChoice } from './workloadStore';
export type { WorkloadScope } from './workloadModel';

function readIds<Row>(
  label: string,
  ids: readonly string[],
  run: (chunk: string[], from: number, to: number) => PromiseLike<CountedRows<Row>>,
  identity: (row: Row) => string,
): Promise<Row[]> {
  return selectIn(ids, async chunk => ({
    data: await readAllPages(label, (from, to) => run(chunk, from, to), identity), error: null,
  }));
}

const rowId = (row: { id: string }) => row.id;

/** An explicit Object detail scope is authorized by that Object's RLS. It
 * does not require its Domain to be visible and never reads sibling Objects.
 * The ExplorerData shape lets existing optimistic edits and deltas update it. */
export async function fetchWorkloadObject(objectId: string, signal?: AbortSignal): Promise<ExplorerData> {
  const abort = signal ?? new AbortController().signal;
  const objects = await readAllPages<AlconObject>('Workload Object', (from, to) => supabase
    .from('objects').select('*', { count: 'exact' }).eq('id', objectId)
    .order('id').range(from, to).abortSignal(abort), rowId);
  const object = objects[0];
  if (!object) throw new Error('This Object is no longer available.');
  const [directElements, homes] = await Promise.all([
    readAllPages<Element>('Object Elements', (from, to) => supabase
      .from('elements').select('*', { count: 'exact' }).eq('object_id', objectId)
      .order('id').range(from, to).abortSignal(abort), rowId),
    readAllPages<{ element_id: string }>('Object Element membership', (from, to) => supabase
      .from('element_objects').select('element_id', { count: 'exact' }).eq('object_id', objectId)
      .order('element_id').range(from, to).abortSignal(abort), row => row.element_id),
  ]);
  const directIds = new Set(directElements.map(row => row.id));
  const linkedElements = await readIds<Element>('Linked Object Elements', homes.map(row => row.element_id).filter(id => !directIds.has(id)),
    (chunk, from, to) => supabase.from('elements').select('*', { count: 'exact' }).in('id', chunk)
      .order('id').range(from, to).abortSignal(abort), rowId);
  const elements = [...directElements, ...linkedElements];
  const assignees = await readIds<ElementAssignee>('Object assignments', elements.map(row => row.id),
    (chunk, from, to) => supabase.from('element_assignees').select('*', { count: 'exact' }).in('element_id', chunk)
      .order('id').range(from, to).abortSignal(abort), rowId);
  const workers = await readIds<Worker>('Assigned Workers', assignees.map(row => row.worker_id),
    (chunk, from, to) => supabase.from('workers').select('*', { count: 'exact' }).in('id', chunk)
      .order('id').range(from, to).abortSignal(abort), rowId);
  const workerById = new Map(workers.map(worker => [worker.id, worker]));
  const assignments = new Map<string, ElementAssignee[]>();
  for (const assignee of assignees) {
    const group = assignments.get(assignee.element_id) ?? [];
    group.push(assignee);
    assignments.set(assignee.element_id, group);
  }
  const rows: ElementWithDetails[] = elements.map(element => ({
    ...element,
    objectIds: [objectId],
    assignees: (assignments.get(element.id) ?? []).map(assignee => ({ ...assignee, worker: workerById.get(assignee.worker_id) })),
  }));
  return { objects: [{ ...object, elements: rows }], rootElements: [] };
}

/** Workload observes the same Domain explorer entries as Execution. Optimistic
 * edits and confirmed deltas therefore update both surfaces through one cache. */
export function useWorkloadData(scopeOverride?: WorkloadScope) {
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const contextKey = JSON.stringify([userId, spaceId]);
  const domainQuery = useSustainmentDomains();
  const domains = domainQuery.data;
  // The standalone surface and its sidebar share one Domain choice per Space.
  const selection: WorkloadSelection = { contextKey, domainIds: useWorkloadDomainChoice(contextKey) };
  const accessibleIds = domains.map(domain => domain.id);
  const { selectedDomainIds, domainIds, objectIds } = resolveWorkloadScope(selection, contextKey, accessibleIds, scopeOverride);
  const setSelectedDomainIds = (update: (previous: string[]) => string[]) => {
    const next = update(workloadDomainIds(selection, contextKey, accessibleIds));
    // Every Domain chosen is "follow all", so a Domain created later joins.
    setWorkloadDomainChoice(contextKey, next.length === accessibleIds.length && accessibleIds.every(id => next.includes(id)) ? null : next);
  };
  const explorers = useQueries({ queries: [
    ...domainIds.map(id => ({
      queryKey: ['explorer', id],
      queryFn: () => fetchExplorerData(id),
      enabled: Boolean(userId),
    })),
    ...objectIds.map(id => ({
      queryKey: ['explorer', 'object', id, userId],
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchWorkloadObject(id, signal),
      enabled: Boolean(userId),
    })),
  ] });
  const elements = selectWorkloadElements(explorers.flatMap((query, index) => query.data
    ? [{ domainId: domainIds[index] ?? null, data: query.data }] : []), domainIds, objectIds);
  // Exact guest Domain/Object tabs do not depend on the active Space's list.
  const needsDomains = !scopeOverride;
  const loading = (needsDomains && domainQuery.loading) || Boolean(userId && explorers.some(query => query.isPending));
  const error = (needsDomains ? domainQuery.error : null) ?? explorers.find(query => query.error)?.error ?? null;
  const retry = useCallback(async () => {
    await Promise.all([domainQuery.refetch(), ...explorers.map(query => query.refetch())]);
  }, [domainQuery, explorers]);

  return { contextKey, domains, selectedDomainIds, setSelectedDomainIds, elements, loading, error, retry };
}
