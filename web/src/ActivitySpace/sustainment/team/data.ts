'use client';

import { appDialog } from '@/Function/shared/appDialogStore';
import { translate } from '@/Function/i18n/I18nProvider';
import { addElementAssignee } from '@/ActivitySpace/execution/element/data';
import { partitionAssignable } from '@/Function/shared/assignableWorkers';
import type { LoadElement } from '@/Function/shared/assignmentLoad';
import { getActiveSpaceId, useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Json, Worker, WorkerAvailability, WorkerAvailabilityInsert } from '@/types/database';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';


// ============================================
// Hook: Fetch Workers
// ============================================
// Who can be assigned follows the Space boundary, and the server decides it:
// every list here reads `list_assignable_workers` (a person through their
// Space / Domain / Object memberships, an Object's Worker through its Object,
// an unlinked Worker through workers.activity_space_id).
//
// Workers go through the query cache, keyed by scope. PersonCell (the Assign /
// person-column cell) calls useWorkers PER CELL, so an Object list with N rows
// once fired N identical queries. One query key per scope means N cells share
// one request, remounts read the cache, and a warm cache fires nothing until a
// worker mutation invalidates it.
//
// Every value under ['workers'] is a Worker[] — the delta stream scans them
// all for a Worker by id (findWorkerInCaches).
const WORKERS_QUERY_PREFIX = ['workers'] as const;

export interface AssignableScope {
  /** The Space the pickers offer Workers from — normally the active Space. */
  spaceId?: string | null;
  /** Narrow to people who can see this Domain (its own Space wins). */
  domainId?: string | null;
  /** Exactly the Workers assignable to this Element; the other keys are ignored. */
  elementId?: string | null;
}

function assignableKey(scope: AssignableScope) {
  return scope.elementId
    ? [...WORKERS_QUERY_PREFIX, 'assignable', 'element', scope.elementId]
    : [...WORKERS_QUERY_PREFIX, 'assignable', scope.spaceId ?? '__all__', scope.domainId ?? '__all__'];
}

async function loadAssignableWorkers(scope: AssignableScope): Promise<Worker[]> {
  const { data, error } = await supabase.rpc('list_assignable_workers', {
    p_space_id: scope.elementId ? null : scope.spaceId ?? null,
    p_domain_id: scope.elementId ? null : scope.domainId ?? null,
    p_element_id: scope.elementId ?? null,
  });
  if (error) throw error;
  return (data ?? []) as Worker[];
}

/** Workers the caller may assign in `scope`, through the query cache. */
export function fetchAssignableWorkers(scope: AssignableScope): Promise<Worker[]> {
  return getQueryClient().fetchQuery({
    queryKey: assignableKey(scope),
    queryFn: () => loadAssignableWorkers(scope),
    staleTime: 30_000,
  });
}

/** Drop every cached worker list so the next read refetches (e.g. after a
 *  worker is added or removed). Covers useWorkers and fetchAllWorkers. */
export function invalidateWorkersCache() {
  const qc = getQueryClient();
  for (const queryKey of [WORKERS_QUERY_PREFIX, ['team-roster'], ['explorer'], ['decisionLab'], ['initiativeRisk']]) {
    void qc.invalidateQueries({ queryKey });
  }
}

const EMPTY_WORKERS: Worker[] = [];

export function useAssignableWorkers(scope: AssignableScope, enabled = true) {
  const query = useQuery({
    queryKey: assignableKey(scope),
    queryFn: () => loadAssignableWorkers(scope),
    enabled,
  });
  return {
    data: query.data ?? EMPTY_WORKERS,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

/** The Workers assignable in the active Space. */
export function useWorkers() {
  return useAssignableWorkers({ spaceId: useActiveSpaceId() });
}

async function loadWorkerById(id: string): Promise<Worker[]> {
  const { data, error } = await supabase.from('workers').select('*').eq('id', id);
  if (error) throw error;
  return (data ?? []) as Worker[];
}

/**
 * The Worker behind a stored id, for showing a current value by name. Taken
 * from `candidates` when it is there; otherwise read by id, so a value chosen
 * outside the current candidate list (another Space, or before the boundary)
 * still renders by name.
 */
export function useWorkerById(
  id: string | null | undefined,
  candidates: readonly Worker[] = EMPTY_WORKERS,
): Worker | null {
  const fromList = id ? candidates.find((w) => w.id === id) ?? null : null;
  const query = useQuery({
    queryKey: [...WORKERS_QUERY_PREFIX, 'byId', id ?? ''],
    queryFn: () => loadWorkerById(id as string),
    enabled: !!id && !fromList,
    staleTime: 60_000,
  });
  return fromList ?? query.data?.[0] ?? null;
}

async function loadWorkersByIds(ids: readonly string[]): Promise<Worker[]> {
  return selectIn<Worker>(ids, (chunk) => supabase.from('workers').select('*').in('id', chunk));
}

/** The Workers behind stored ids (bindings, calendar picks), read by id so a
 *  name renders even when it is not a candidate in the active Space. */
export function useWorkersByIds(ids: readonly string[]): Worker[] {
  const sorted = useMemo(() => [...new Set(ids)].sort(), [ids]);
  const query = useQuery({
    queryKey: [...WORKERS_QUERY_PREFIX, 'byIds', sorted.join(',')],
    queryFn: () => loadWorkersByIds(sorted),
    enabled: sorted.length > 0,
    staleTime: 60_000,
  });
  return query.data ?? EMPTY_WORKERS;
}

async function loadSelfWorkers(userId: string): Promise<Worker[]> {
  const { data, error } = await supabase
    .from('workers').select('*')
    .eq('user_id', userId).eq('type', 'human').is('object_id', null)
    .limit(1);
  if (error) throw error;
  return (data ?? []) as Worker[];
}

/** The signed-in person's own human Worker. */
export function useSelfWorker(userId: string | null | undefined): Worker | null {
  const query = useQuery({
    queryKey: [...WORKERS_QUERY_PREFIX, 'self', userId ?? ''],
    queryFn: () => loadSelfWorkers(userId as string),
    enabled: !!userId,
  });
  return query.data?.[0] ?? null;
}

/**
 * Assign Workers to a just-created Element. The ids are checked against the
 * Element's assignable list first, so a template or default naming a Worker
 * from another Space is skipped and reported instead of attempted; one
 * refusal does not stop the rest.
 */
export async function assignWorkersToElement(
  elementId: string,
  workerIds: readonly string[],
): Promise<{ assigned: string[]; skipped: string[] }> {
  if (workerIds.length === 0) return { assigned: [], skipped: [] };
  let candidates: Worker[] = [];
  try {
    candidates = await loadAssignableWorkers({ elementId });
  } catch (e) {
    console.warn('Could not read who can be assigned:', e);
    return { assigned: [], skipped: [...new Set(workerIds)] };
  }
  const { assignable, skipped } = partitionAssignable(workerIds, candidates);
  const assigned: string[] = [];
  for (const wid of assignable) {
    try {
      await addElementAssignee({
        element_id: elementId, worker_id: wid, role: 'assignee',
        worker: candidates.find((w) => w.id === wid),
      });
      assigned.push(wid);
    } catch (e) {
      console.warn('Could not assign Element:', e);
      skipped.push(wid);
    }
  }
  return { assigned, skipped };
}

/** Tell the person, once per batch, that some chosen assignees were left off. */
export function noticeSkippedAssignees(count: number): void {
  if (count <= 0) return;
  void appDialog.alert(translate(
    '{n} assignee(s) were not added: they are inactive or cannot see this Element.', { n: count }));
}

/** Tell the person an assignee change did not save. The database refuses
 *  (42501) a Worker that worker_assignable does not accept; anything else is a
 *  plain failure. The optimistic chip has already been rolled back. */
export function noticeAssignmentFailed(error: unknown): void {
  console.error('Assignee change failed:', error);
  const code = (error as { code?: string } | null)?.code;
  void appDialog.alert(translate(code === '42501'
    ? 'This Worker cannot be assigned to this Element: they are inactive, outside its Space, or cannot see it.'
    : 'The assignees could not be changed. Try again.'));
}

// ============================================
// Worker CRUD
//
// The database decides who may change a Worker (workers RLS): your own
// Worker; an unlinked Worker of a Space you belong to; an Object's Worker on
// an Object you can see; someone else's Worker as an owner of their Space or
// Domain. Removing is only for unlinked Workers, by an owner of their Space —
// a person's Worker stays so the work they did keeps their name. RLS turns a
// refused UPDATE / DELETE into "no rows", so both writers below say so instead
// of reporting success.
// ============================================

const WORKER_REFUSED = 'You cannot change this Worker. Ask an owner of its Space or Domain.';

export async function createWorker(worker: {
  name: string;
  type: 'human' | 'ai_agent';
  object_id?: string | null;
  /** For a Worker with no Object: the Space it belongs to. Defaults to the
   *  active Space. */
  activity_space_id?: string | null;
  role?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  ai_model?: string | null;
  ai_config?: Json | null;
}): Promise<Worker> {
  const objectId = worker.object_id || null;
  const { data, error } = await supabase
    .from('workers')
    .insert({
      name: worker.name,
      type: worker.type,
      object_id: objectId,
      activity_space_id: objectId ? null : worker.activity_space_id ?? getActiveSpaceId(),
      role: worker.role || null,
      email: worker.email || null,
      avatar_url: worker.avatar_url || null,
      ai_model: worker.ai_model || null,
      ai_config: worker.ai_config || null,
      status: 'active',
    })
    .select()
    .single();

  if (error) throw error;
  invalidateWorkersCache();
  return data;
}

export async function updateWorker(
  id: string,
  updates: Partial<Omit<Worker, 'id' | 'created_at'>>
): Promise<Worker> {
  const { data, error } = await supabase
    .from('workers')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(translate(WORKER_REFUSED));
  invalidateWorkersCache();
  return data;
}

export async function deleteWorker(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('workers')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) throw error;
  if (!data?.length) throw new Error(translate(WORKER_REFUSED));
  invalidateWorkersCache();
}

// ============================================
// Worker availability CRUD
//
// The spans where a Worker's capacity is not the standing one. What they mean
// as hours per day lives in `Function/shared/workerCapacity.ts`; this is only the
// reading and writing.
// ============================================

/**
 * Every availability span for the given Workers, oldest start first.
 *
 * The id list is as long as the roster, so it goes through `selectIn` — a bare
 * `.in()` puts the whole list in the query string and stops working on a board
 * big enough that nobody's fixture reproduces it.
 */
export async function fetchWorkerAvailability(
  workerIds: string[],
): Promise<WorkerAvailability[]> {
  return selectIn<WorkerAvailability>(
    workerIds,
    (chunk) => supabase
      .from('worker_availability')
      .select('*')
      .in('worker_id', chunk)
      .order('start_date', { ascending: true }),
    { compare: (a, b) => a.start_date.localeCompare(b.start_date) },
  );
}

async function createWorkerAvailability(
  span: WorkerAvailabilityInsert,
): Promise<WorkerAvailability> {
  const { data, error } = await supabase
    .from('worker_availability')
    .insert({
      worker_id: span.worker_id,
      start_date: span.start_date,
      end_date: span.end_date,
      kind: span.kind ?? 'leave',
      capacity_hours_per_day: span.capacity_hours_per_day ?? 0,
      note: span.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as WorkerAvailability;
}

async function deleteWorkerAvailability(id: string): Promise<void> {
  const { error } = await supabase
    .from('worker_availability')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

/** Shared empty map, so an empty roster returns the same object every render. */
const EMPTY_AVAILABILITY: Record<string, WorkerAvailability[]> = {};

/**
 * Availability grouped by Worker, plus the writers that keep the group in step
 * with the server.
 *
 * The writers hand back the rolled-back state on failure rather than swallowing
 * it: an absence that looks saved but is not would put the load chart back to
 * the lie this table exists to end.
 */
async function fetchAvailabilityByWorker(ids: string[]): Promise<Record<string, WorkerAvailability[]>> {
  // Say so on failure — the cache keeps the last map (stale beats blank),
  // but a silent failure would let the chart lie with no trace.
  const rows = await fetchWorkerAvailability(ids).catch((e) => {
    console.error('Failed to fetch worker availability:', e);
    throw e;
  });
  const next: Record<string, WorkerAvailability[]> = {};
  for (const row of rows) (next[row.worker_id] ??= []).push(row);
  return next;
}

export function useWorkerAvailability(workerIds: string[]) {
  // Callers rebuild the ids array every render (map over chart rows) — depend
  // on the sorted membership, not the array identity.
  const idsKey = useMemo(() => [...workerIds].sort().join('\n'), [workerIds]);
  const qc = useQueryClient();
  const key = useMemo(() => ['worker-availability', idsKey] as const, [idsKey]);
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchAvailabilityByWorker(idsKey.split('\n')),
    enabled: !!idsKey,
    // A roster change selects a new key; keep the previous map painted
    // until the new one lands rather than showing every worker absence-free.
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000,
  });
  const byWorker = query.data ?? EMPTY_AVAILABILITY;
  // Optimistic edits land in the cache so every reader of this roster moves.
  // Cancel any in-flight fetch first — its (pre-write) rows would otherwise
  // overwrite the edit when it resolved.
  const setByWorker = useCallback(
    (update: (prev: Record<string, WorkerAvailability[]>) => Record<string, WorkerAvailability[]>) => {
      void qc.cancelQueries({ queryKey: key });
      qc.setQueryData<Record<string, WorkerAvailability[]>>(key, (prev) => update(prev ?? {}));
    },
    [qc, key],
  );

  const add = useCallback(async (span: WorkerAvailabilityInsert) => {
    const now = new Date().toISOString();
    const temp: WorkerAvailability = {
      id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      worker_id: span.worker_id,
      start_date: span.start_date,
      end_date: span.end_date,
      kind: span.kind ?? 'leave',
      capacity_hours_per_day: span.capacity_hours_per_day ?? 0,
      note: span.note ?? null,
      created_at: now,
      updated_at: now,
    };
    const sorted = (rows: WorkerAvailability[]) =>
      [...rows].sort((a, b) => a.start_date.localeCompare(b.start_date));
    setByWorker((prev) => ({
      ...prev,
      [temp.worker_id]: sorted([...(prev[temp.worker_id] ?? []), temp]),
    }));
    try {
      const saved = await createWorkerAvailability(span);
      setByWorker((prev) => ({
        ...prev,
        [saved.worker_id]: sorted(
          (prev[saved.worker_id] ?? []).map((r) => (r.id === temp.id ? saved : r)),
        ),
      }));
    } catch (e) {
      setByWorker((prev) => ({
        ...prev,
        [temp.worker_id]: (prev[temp.worker_id] ?? []).filter((r) => r.id !== temp.id),
      }));
      throw e;
    } finally {
      await qc.invalidateQueries({ queryKey: ['worker-availability'] });
    }
  }, [setByWorker, qc]);

  const remove = useCallback(async (span: WorkerAvailability) => {
    setByWorker((prev) => ({
      ...prev,
      [span.worker_id]: (prev[span.worker_id] ?? []).filter((r) => r.id !== span.id),
    }));
    try {
      await deleteWorkerAvailability(span.id);
    } catch (e) {
      setByWorker((prev) => ({
        ...prev,
        [span.worker_id]: [...(prev[span.worker_id] ?? []), span]
          .sort((a, b) => a.start_date.localeCompare(b.start_date)),
      }));
      throw e;
    } finally {
      await qc.invalidateQueries({ queryKey: ['worker-availability'] });
    }
  }, [setByWorker, qc]);

  return {
    byWorker, add, remove,
    loading: !!idsKey && (query.isPending || query.isPlaceholderData),
    error: query.error,
    refetch: query.refetch,
  };
}

// ============================================
// Worker commitments
//
// What each Worker is already holding, cut down to the columns that decide
// load: the dates it spans and what it costs. The assignee menu asks this
// before anybody is added, so it pulls the Elements themselves rather than the
// Explorer tree — a Worker's other work is spread across Domains the open list
// never loaded.
// ============================================

/** Shared empty map, so an empty roster returns the same object every render. */
const EMPTY_COMMITMENTS: Record<string, LoadElement[]> = {};

async function fetchWorkerCommitments(
  workerIds: string[],
): Promise<Record<string, LoadElement[]>> {
  const links = await selectIn<{ element_id: string; worker_id: string }>(
    workerIds,
    (chunk) => supabase
      .from('element_assignees')
      .select('element_id, worker_id')
      .in('worker_id', chunk),
  );
  if (links.length === 0) return {};

  const rows = await selectIn<LoadElement>(
    links.map((l) => l.element_id),
    (chunk) => supabase
      .from('elements')
      .select('id, start_date, due_date, estimated_hours, priority, status')
      .in('id', chunk),
  );

  const byId = new Map(rows.map((r) => [r.id, r]));
  const byWorker: Record<string, LoadElement[]> = {};
  for (const link of links) {
    const element = byId.get(link.element_id);
    if (!element) continue;
    (byWorker[link.worker_id] ??= []).push(element);
  }
  return byWorker;
}

/**
 * Every dated Element the given Workers hold, grouped by Worker.
 *
 * Read-only and unsubscribed: it answers a question asked inside an open menu,
 * and a live subscription would keep the whole roster's work in memory for as
 * long as the app runs to serve a panel that is usually closed.
 */
export function useWorkerCommitments(workerIds: string[]) {
  const idsKey = useMemo(() => [...workerIds].sort().join('\n'), [workerIds]);
  const query = useQuery({
    queryKey: ['worker-commitments', idsKey],
    queryFn: () =>
      fetchWorkerCommitments(idsKey.split('\n')).catch((e) => {
        // Stale beats blank, but a silent failure would let the menu report
        // "fits fine" from a load it failed to read.
        console.error('Failed to fetch worker commitments:', e);
        throw e;
      }),
    enabled: !!idsKey,
    // A roster change selects a new key; keep the previous map until the
    // new one lands.
    placeholderData: keepPreviousData,
    gcTime: 5 * 60_000,
  });
  return query.data ?? EMPTY_COMMITMENTS;
}

// ============================================
// Fetch All Workers (for actor selection)
// ============================================
/** The Workers assignable in the active Space, narrowed to people who can see
 *  `domainId` when one is given. Cached per scope: a dozen surfaces (detail
 *  views, table rows, pickers) call this from an effect. */
export function fetchAllWorkers(domainId?: string | null): Promise<Worker[]> {
  return fetchAssignableWorkers({ spaceId: getActiveSpaceId(), domainId: domainId ?? null });
}
