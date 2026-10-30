'use client';

import { ascNullsLast } from '@/hooks/strategyData';
import { selectIn } from '@/hooks/chunkedIn';
import { supabase } from '@/lib/supabase';
import type { ObjectMilestone } from '@/types/database';
import { useQuery } from '@tanstack/react-query';

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

/** Read-only milestones for a set of Objects, e.g. the Gantt's diamond
 *  markers. Keyed on the sorted id set (not the array reference) so passing
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
