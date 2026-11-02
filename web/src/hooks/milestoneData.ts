'use client';

import { ascNullsLast } from '@/hooks/strategyData';
import { selectIn } from '@/hooks/chunkedIn';
import { translate } from '@/Function/i18n/I18nProvider';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { ObjectMilestone, ObjectMilestoneInsert, ObjectMilestoneUpdate } from '@/types/database';
import { useQuery, type QueryKey } from '@tanstack/react-query';

// ============================================
// Object Milestones — ◇ markers on the Timeline
// ============================================

/** Bulk-fetch milestones for a set of Objects. Used by the Strategy
 *  Timeline view to render diamonds above each Object's band. */
async function fetchObjectMilestones(objectIds: string[]): Promise<ObjectMilestone[]> {
  return await selectIn(
    objectIds,
    chunk =>
      supabase
        .from('object_milestones')
        .select('*')
        .in('object_id', chunk)
        .order('date', { ascending: true }),
    { compare: (a, b) => ascNullsLast(a.date, b.date) },
  ) as ObjectMilestone[];
}

const OBJECT_MILESTONES_QUERY_PREFIX = ['object-milestones'] as const;
const EMPTY_MILESTONES: ObjectMilestone[] = [];

/** Milestones for a set of Objects — the Gantt's diamond markers and the
 *  Object Overview's Milestones widget read the same cache. Keyed on the sorted id set (not the array reference) so passing
 *  a freshly-mapped array every render still hits the same cache entry. */
export function useObjectMilestones(objectIds: string[]) {
  const key = [...objectIds].sort().join(',');
  const query = useQuery({
    queryKey: [...OBJECT_MILESTONES_QUERY_PREFIX, key],
    queryFn: () => fetchObjectMilestones(objectIds),
    enabled: objectIds.length > 0,
  });
  return {
    data: query.data ?? EMPTY_MILESTONES,
    loading: objectIds.length > 0 && query.isPending,
    error: (query.error as Error | null) ?? null,
  };
}

// ── Writes ────────────────────────────────────────────────
//
// Every cached id set holding the Object is patched first, so the widget and
// the Gantt's ◇ move together, then the server's answer replaces the guess.
// On failure the snapshot comes back and the error is thrown to the caller.
//
// RLS hides rows the writer may not touch instead of refusing them: an update
// or delete that matched nothing would otherwise "succeed" and the change
// would quietly vanish on the next read, so both ask for the rows back.

type Snapshot = Array<[QueryKey, ObjectMilestone[] | undefined]>;

function patchMilestones(objectId: string, patch: (rows: ObjectMilestone[]) => ObjectMilestone[]): Snapshot {
  const qc = getQueryClient();
  const snapshot = qc.getQueriesData<ObjectMilestone[]>({ queryKey: OBJECT_MILESTONES_QUERY_PREFIX });
  for (const [key, rows] of snapshot) {
    const ids = String(key[1] ?? '').split(',');
    if (!rows || !ids.includes(objectId)) continue;
    qc.setQueryData<ObjectMilestone[]>(key, patch(rows));
  }
  return snapshot;
}

function restore(snapshot: Snapshot) {
  const qc = getQueryClient();
  for (const [key, rows] of snapshot) qc.setQueryData(key, rows);
}

function invalidateMilestones() {
  void getQueryClient().invalidateQueries({ queryKey: OBJECT_MILESTONES_QUERY_PREFIX });
}

const byDate = (a: ObjectMilestone, b: ObjectMilestone) => ascNullsLast(a.date, b.date);

function notAllowed(): Error {
  return new Error(translate('You do not have permission to change this milestone.'));
}

export async function createObjectMilestone(input: ObjectMilestoneInsert): Promise<ObjectMilestone> {
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const draft: ObjectMilestone = {
    id, object_id: input.object_id, date: input.date, label: input.label ?? null, created_at: now, updated_at: now,
  };
  const snapshot = patchMilestones(input.object_id, rows => [...rows, draft].sort(byDate));
  const { data, error } = await supabase
    .from('object_milestones')
    .insert({ ...input, id })
    .select()
    .single();
  if (error) {
    restore(snapshot);
    throw error.code === '42501' ? notAllowed() : error;
  }
  invalidateMilestones();
  return data as ObjectMilestone;
}

export async function updateObjectMilestone(
  milestone: Pick<ObjectMilestone, 'id' | 'object_id'>,
  updates: ObjectMilestoneUpdate,
): Promise<ObjectMilestone> {
  const snapshot = patchMilestones(milestone.object_id, rows =>
    rows.map(r => (r.id === milestone.id ? { ...r, ...updates } : r)).sort(byDate));
  const { data, error } = await supabase
    .from('object_milestones')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', milestone.id)
    .select();
  if (error || !data || data.length === 0) {
    restore(snapshot);
    throw error ?? notAllowed();
  }
  invalidateMilestones();
  return data[0] as ObjectMilestone;
}

export async function deleteObjectMilestone(milestone: Pick<ObjectMilestone, 'id' | 'object_id'>): Promise<void> {
  const snapshot = patchMilestones(milestone.object_id, rows => rows.filter(r => r.id !== milestone.id));
  const { data, error } = await supabase
    .from('object_milestones')
    .delete()
    .eq('id', milestone.id)
    .select('id');
  if (error || !data || data.length === 0) {
    restore(snapshot);
    throw error ?? notAllowed();
  }
  invalidateMilestones();
}
