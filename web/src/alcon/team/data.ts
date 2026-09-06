'use client';

import type { LoadElement } from '@/alcon/shared/assignmentLoad';
import { selectIn } from '@/hooks/chunkedIn';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { Json, Worker, WorkerAvailability, WorkerAvailabilityInsert } from '@/types/database';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';


// ============================================
// Hook: Fetch Workers
// ============================================
// Workers through the query cache, keyed by scope. PersonCell (the Assign /
// person-column cell) calls useWorkers PER CELL, so an Object list with N rows
// once fired N identical `workers` queries. One query key per scope means N
// cells share one request, remounts read the cache, and a warm cache fires
// nothing until a worker mutation invalidates it.
const WORKERS_QUERY_PREFIX = ['workers'] as const;

async function loadWorkers(objectId?: string): Promise<Worker[]> {
  let query = supabase.from('workers').select('*');
  if (objectId) query = query.eq('object_id', objectId);
  const { data, error } = await query.order('name');
  if (error) throw error;
  return (data || []) as Worker[];
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

export function useWorkers(objectId?: string) {
  const query = useQuery({
    queryKey: [...WORKERS_QUERY_PREFIX, 'scope', objectId ?? '__all__'],
    queryFn: () => loadWorkers(objectId),
  });
  return {
    data: query.data ?? EMPTY_WORKERS,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

// ============================================
// Worker CRUD
// ============================================

export async function createWorker(worker: {
  name: string;
  type: 'human' | 'ai_agent';
  object_id?: string | null;
  role?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  ai_model?: string | null;
  ai_config?: Json | null;
}): Promise<Worker> {
  const { data, error } = await supabase
    .from('workers')
    .insert({
      name: worker.name,
      type: worker.type,
      object_id: worker.object_id || null,
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
    .single();

  if (error) throw error;
  invalidateWorkersCache();
  return data;
}

export async function deleteWorker(id: string): Promise<void> {
  const { error } = await supabase
    .from('workers')
    .delete()
    .eq('id', id);

  if (error) throw error;
  invalidateWorkersCache();
}

// ============================================
// Worker availability CRUD
//
// The spans where a Worker's capacity is not the standing one. What they mean
// as hours per day lives in `alcon/shared/workerCapacity.ts`; this is only the
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
export function fetchAllWorkers(domainId?: string | null): Promise<Worker[]> {
  // Cached per Domain: a dozen surfaces (detail views, table rows, pickers)
  // each call this from an effect, so without the cache an Element table
  // fired one workers + one domain_members query per row.
  return getQueryClient().fetchQuery({
    queryKey: [...WORKERS_QUERY_PREFIX, 'domain', domainId ?? '__all__'],
    queryFn: () => fetchAllWorkersUncached(domainId),
    staleTime: 30_000,
  });
}

async function fetchAllWorkersUncached(domainId?: string | null): Promise<Worker[]> {
  // Domain-scoped — humans must be members of this Domain (via
  // domain_members.user_id), AI / robot workers are always included since
  // membership for them is implicit (they're scoped via ai_config etc.).
  // No domainId given → return everyone (global view / backwards-compat).
  // The two lookups are independent, so they run in parallel.
  const [{ data, error }, memberRows] = await Promise.all([
    supabase.from('workers').select('*').order('name'),
    domainId
      ? supabase.from('domain_members').select('user_id').eq('domain_id', domainId).then((r) => r.data)
      : Promise.resolve(null),
  ]);
  if (error) throw error;
  const workers = (data || []) as Worker[];
  if (!domainId) return workers;

  const memberUserIds = new Set(
    ((memberRows ?? []) as { user_id: string }[]).map((r) => r.user_id),
  );
  return workers.filter(
    (w) => w.type !== 'human' || (w.user_id != null && memberUserIds.has(w.user_id)),
  );
}
