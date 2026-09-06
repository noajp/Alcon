'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { selectIn } from '@/hooks/chunkedIn';
import type { Intent } from '@/types/database';

/** The cascade and the editors share invalidation after human or AI writes. */
export function useInitiativeMeasures(initiativeIds: string[]) {
  const ids = [...new Set(initiativeIds)].sort();
  const query = useQuery({
    queryKey: ['initiative-measures', ids],
    queryFn: () => selectIn<Intent>(ids, (chunk) => supabase
      .from('intents').select('*').in('strategy_id', chunk)
      .eq('kind', 'measure').order('order_index', { ascending: true })),
    enabled: ids.length > 0,
  });
  return {
    measures: query.data ?? NO_MEASURES,
    loading: ids.length > 0 && query.isLoading,
    error: query.error,
  };
}
const NO_MEASURES: Intent[] = [];
