'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getActiveSpaceId, useActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { buildTeamRoster, type TeamElement, type TeamRosterSource } from '@/alcon/team/teamRoster';
import { updateWorker } from '@/alcon/team/data';
import { selectIn } from '@/hooks/chunkedIn';
import { readAllPages, type CountedRows } from '@/hooks/readAllPages';
import { fetchSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { Worker } from '@/types/database';

function readIds<Row>(
  label: string,
  ids: readonly string[],
  run: (chunk: string[], from: number, to: number) => PromiseLike<CountedRows<Row>>,
  identity: (row: Row) => string,
): Promise<Row[]> {
  return selectIn(ids, async (chunk) => ({
    data: await readAllPages(label, (from, to) => run(chunk, from, to), identity), error: null,
  }));
}

const rowId = (row: { id: string }) => row.id;
const unique = <Row extends { id: string }>(rows: Row[]) => [...new Map(rows.map((row) => [row.id, row])).values()];
const ELEMENT_FIELDS = 'id, title, display_id, status, due_date, object_id';

async function fetchTeamRoster(spaceId: string, signal: AbortSignal): Promise<TeamRosterSource> {
  const [domains, spaceMembers] = await Promise.all([
    fetchSustainmentDomains(spaceId, signal),
    readAllPages<TeamRosterSource['spaceMembers'][number]>('Space members', (from, to) => supabase
      .from('activity_space_members').select('user_id, role', { count: 'exact' }).eq('activity_space_id', spaceId)
      .order('user_id').range(from, to).abortSignal(signal), (row) => row.user_id),
  ]);
  const domainIds = domains.map((row) => row.id);
  const [domainMembers, objectDomains, directObjects] = await Promise.all([
    readIds<TeamRosterSource['domainMembers'][number]>('Domain members', domainIds, (chunk, from, to) => supabase
      .from('domain_members').select('user_id, domain_id, role', { count: 'exact' }).in('domain_id', chunk)
      .order('domain_id').order('user_id').range(from, to).abortSignal(signal), (row) => `${row.domain_id}:${row.user_id}`),
    readIds<TeamRosterSource['objectDomains'][number]>('Object Domains', domainIds, (chunk, from, to) => supabase
      .from('object_domains').select('object_id, domain_id', { count: 'exact' }).in('domain_id', chunk)
      .order('object_id').order('domain_id').range(from, to).abortSignal(signal), (row) => `${row.object_id}:${row.domain_id}`),
    readIds<TeamRosterSource['objects'][number]>('Team Objects', domainIds, (chunk, from, to) => supabase
      .from('objects').select('id, domain_id', { count: 'exact' }).in('domain_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
  ]);
  const directObjectIds = new Set(directObjects.map((row) => row.id));
  const linkedObjects = await readIds<TeamRosterSource['objects'][number]>('Linked Team Objects', objectDomains
    .map((row) => row.object_id).filter((id) => !directObjectIds.has(id)), (chunk, from, to) => supabase
    .from('objects').select('id, domain_id', { count: 'exact' }).in('id', chunk)
    .order('id').range(from, to).abortSignal(signal), rowId);
  const objects = unique([...directObjects, ...linkedObjects]);
  const objectIds = objects.map((row) => row.id);
  const [memberWorkers, objectWorkers, directElements, elementHomes] = await Promise.all([
    readIds<Worker>('Member Workers', [...spaceMembers, ...domainMembers].map((row) => row.user_id), (chunk, from, to) => supabase
      .from('workers').select('*', { count: 'exact' }).in('user_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<Worker>('Object Workers', objectIds, (chunk, from, to) => supabase
      .from('workers').select('*', { count: 'exact' }).in('object_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<TeamElement>('Team Elements', objectIds, (chunk, from, to) => supabase
      .from('elements').select(ELEMENT_FIELDS, { count: 'exact' }).in('object_id', chunk)
      .order('id').range(from, to).abortSignal(signal), rowId),
    readIds<{ element_id: string; object_id: string }>('Element Objects', objectIds, (chunk, from, to) => supabase
      .from('element_objects').select('element_id, object_id', { count: 'exact' }).in('object_id', chunk)
      .order('element_id').order('object_id').range(from, to).abortSignal(signal), (row) => `${row.element_id}:${row.object_id}`),
  ]);
  const directElementIds = new Set(directElements.map((row) => row.id));
  const linkedElements = await readIds<TeamElement>('Linked Team Elements', elementHomes
    .map((row) => row.element_id).filter((id) => !directElementIds.has(id)), (chunk, from, to) => supabase
    .from('elements').select(ELEMENT_FIELDS, { count: 'exact' }).in('id', chunk)
    .order('id').range(from, to).abortSignal(signal), rowId);
  const elements = unique([...directElements, ...linkedElements]);
  const assignees = await readIds<TeamRosterSource['assignees'][number]>('Team assignments', elements.map((row) => row.id), (chunk, from, to) => supabase
    .from('element_assignees').select('element_id, worker_id', { count: 'exact' }).in('element_id', chunk)
    .order('element_id').order('worker_id').range(from, to).abortSignal(signal), (row) => `${row.element_id}:${row.worker_id}`);
  const knownWorkers = unique([...memberWorkers, ...objectWorkers]);
  const knownWorkerIds = new Set(knownWorkers.map((row) => row.id));
  const assignedWorkers = await readIds<Worker>('Assigned Workers', assignees
    .map((row) => row.worker_id).filter((id) => !knownWorkerIds.has(id)), (chunk, from, to) => supabase
    .from('workers').select('*', { count: 'exact' }).in('id', chunk)
    .order('id').range(from, to).abortSignal(signal), rowId);
  return { domains, spaceMembers, domainMembers, objectDomains, objects, elements, assignees, workers: unique([...knownWorkers, ...assignedWorkers]) };
}

export function useTeamRoster() {
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const queryClient = useQueryClient();
  const contextKey = JSON.stringify([userId, spaceId]);
  const currentContext = useRef(contextKey);
  const saves = useRef(new Set<string>());
  useEffect(() => { currentContext.current = contextKey; }, [contextKey]);
  const queryKey = useMemo(() => ['team-roster', userId, spaceId] as const, [userId, spaceId]);
  const enabled = Boolean(userId && spaceId);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchTeamRoster(spaceId!, signal),
    enabled,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
    // Space/user are part of the identity. Previous-scope rows are never
    // placeholder data while the new scope is being read. This root is not
    // persisted, so an earlier membership snapshot cannot reappear on launch.
  });
  const entries = useMemo(() => enabled && query.data ? buildTeamRoster(query.data, userId!) : [], [enabled, query.data, userId]);

  const saveCapacity = useCallback(async (workerId: string, hours: number | null) => {
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 24)) throw new Error('Capacity must be between 0 and 24 hours per day.');
    const assertContext = () => {
      if (!enabled || !userId || !spaceId || currentContext.current !== contextKey || getActiveSpaceId() !== spaceId) {
        throw new Error('The active Space or account changed. Open Team again before saving.');
      }
    };
    assertContext();
    if (saves.current.has(workerId)) throw new Error('This Worker is already being saved.');
    saves.current.add(workerId);
    try {
      // Roles may have changed since the page was opened. Re-read before
      // writing instead of trusting the earlier ownership snapshot.
      const fresh = await fetchTeamRoster(spaceId!, new AbortController().signal);
      assertContext();
      const target = buildTeamRoster(fresh, userId!).find((row) => row.worker.id === workerId);
      if (!target?.canManage) throw new Error('Only this Worker or an owner of their Space or Domain can change capacity.');
      const saved = await updateWorker(workerId, { capacity_hours_per_day: hours });
      assertContext();
      await queryClient.cancelQueries({ queryKey });
      assertContext();
      queryClient.setQueryData<TeamRosterSource>(queryKey, {
        ...fresh, workers: fresh.workers.map((worker) => worker.id === saved.id ? saved : worker),
      });
      return saved;
    } finally {
      saves.current.delete(workerId);
    }
  }, [enabled, userId, spaceId, contextKey, queryClient, queryKey]);

  const workers = useMemo(() => entries.map((entry) => entry.worker), [entries]);

  return {
    entries, workers, contextKey, enabled,
    loading: enabled && query.isPending,
    refreshing: enabled && query.isFetching && !query.isPending,
    error: enabled ? query.error : null,
    refresh: query.refetch,
    saveCapacity,
  };
}
