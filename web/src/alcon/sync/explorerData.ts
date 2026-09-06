'use client';

import { EMPTY_EXPLORER_DATA, normalizeExplorerData, type ExplorerData } from '@/alcon/sync/explorerPatch';
import { supabase } from '@/lib/supabase';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';


// ============================================
// Data structure for explorer (flat list of Objects)
// ============================================
// Objects sit directly under a Domain and hold Elements.
export type { ExplorerData } from '@/alcon/sync/explorerPatch';
const ALL_DOMAINS_CACHE_KEY = '__all__';

// Extracted fetcher — used as the queryFn for ['explorer', domainId] and
// reused by anyone who needs to read the full explorer view without going
// through the cache.
export async function fetchExplorerData(domainId?: string | null): Promise<ExplorerData> {
  // Single round trip — the get_explorer_data RPC assembles the whole
  // enriched tree (objects → elements → subelements / assignees+worker,
  // plus domain-scope + object_members membership filtering and the
  // rootElements split) in Postgres. Replaces the previous ~6-query
  // client-side waterfall. SECURITY INVOKER so RLS still applies exactly as
  // before; the output shape matches ExplorerData 1:1.
  const { data, error } = await supabase.rpc('get_explorer_data', {
    p_domain_id: domainId ?? null,
  });
  if (error) throw error;
  return normalizeExplorerData(data as ExplorerData | null);
}

export function useObjects(domainId?: string | null) {
  const cacheKey = domainId ?? ALL_DOMAINS_CACHE_KEY;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['explorer', cacheKey],
    queryFn: () => fetchExplorerData(domainId),
    // Keep the previous domain's data visible while a new one loads — same
    // effect as the old per-instance dataCacheRef, but cache-wide so a
    // remount inherits the last value too.
    placeholderData: keepPreviousData,
  });

  // Realtime deltas arrive through alcon/sync/deltaStream (mounted at the app root).

  // Match the old API — returns a Promise so inline-add submission can await
  // the next data snapshot.
  const refetch = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ['explorer', cacheKey] });
  }, [qc, cacheKey]);

  return {
    data: query.data ?? EMPTY_EXPLORER_DATA,
    loading: query.isPending,
    error: (query.error as Error | null) ?? null,
    refetch,
  };
}
