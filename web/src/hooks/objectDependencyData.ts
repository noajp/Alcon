'use client';

import { useQuery } from '@tanstack/react-query';
import { selectIn } from '@/hooks/chunkedIn';
import { translate } from '@/Function/i18n/I18nProvider';
import { getQueryClient } from '@/lib/queryClient';
import { supabase } from '@/lib/supabase';
import type { ObjectDependency } from '@/types/database';

// Object dependencies ("blocked waits for blocker"), read for a set of
// Objects: every link with either end in the set. The Gantt draws them; the
// Object's side panel adds and removes them.

const PREFIX = ['object-dependencies'] as const;
const EMPTY: ObjectDependency[] = [];

async function fetchObjectDependencies(objectIds: string[]): Promise<ObjectDependency[]> {
  const [asBlocked, asBlocker] = await Promise.all([
    selectIn(objectIds, (chunk) => supabase.from('object_dependencies').select('*').in('blocked_object_id', chunk)),
    selectIn(objectIds, (chunk) => supabase.from('object_dependencies').select('*').in('blocker_object_id', chunk)),
  ]);
  const byId = new Map<string, ObjectDependency>();
  for (const row of [...asBlocked, ...asBlocker] as ObjectDependency[]) byId.set(row.id, row);
  return [...byId.values()];
}

export function useObjectDependencies(objectIds: string[]) {
  const key = [...objectIds].sort().join(',');
  const query = useQuery({
    queryKey: [...PREFIX, key],
    queryFn: () => fetchObjectDependencies(objectIds),
    enabled: objectIds.length > 0,
  });
  return { data: query.data ?? EMPTY, loading: objectIds.length > 0 && query.isPending };
}

function invalidate() {
  void getQueryClient().invalidateQueries({ queryKey: PREFIX });
}

/** Records that `blockedId` waits for `blockerId`. */
export async function addObjectDependency(blockerId: string, blockedId: string): Promise<void> {
  const { data, error } = await supabase.from('object_dependencies')
    .insert({ blocker_object_id: blockerId, blocked_object_id: blockedId }).select('id');
  if (error) throw new Error(error.message);
  // RLS refuses by returning nothing: say so instead of pretending it landed.
  if (!data || data.length === 0) throw new Error(translate('You do not have permission to change this Object.'));
  invalidate();
}

export async function removeObjectDependency(id: string): Promise<void> {
  const { data, error } = await supabase.from('object_dependencies').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error(translate('You do not have permission to change this Object.'));
  invalidate();
}
