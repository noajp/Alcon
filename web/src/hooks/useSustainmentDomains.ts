'use client';

import { useQuery } from '@tanstack/react-query';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { readAllPages } from '@/hooks/readAllPages';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import type { Domain } from '@/types/database';

/** RLS is the authority for visibility: public Space Domains, owned Domains,
 * and invited Domains all qualify without requiring a domain_members row. */
export function fetchSustainmentDomains(spaceId: string, signal?: AbortSignal): Promise<Domain[]> {
  if (!spaceId) return Promise.resolve([]);
  return readAllPages<Domain>('Sustainment Domains', (from, to) => {
    const query = supabase.from('domains').select('*', { count: 'exact' })
      .eq('activity_space_id', spaceId).order('id').range(from, to);
    return signal ? query.abortSignal(signal) : query;
  }, domain => domain.id);
}

const EMPTY_DOMAINS: Domain[] = [];

/** Shared Space boundary for Team, Workload and Calendar. The previous Space
 * is never placeholder data; a failed read is not a zero-workload result. */
export function useSustainmentDomains() {
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const enabled = Boolean(userId && spaceId);
  const query = useQuery({
    queryKey: ['sustainment-domains', userId, spaceId],
    queryFn: ({ signal }) => fetchSustainmentDomains(spaceId!, signal),
    enabled,
    staleTime: 0,
    gcTime: 60_000,
    refetchOnWindowFocus: true,
  });
  return {
    data: enabled ? query.data ?? EMPTY_DOMAINS : EMPTY_DOMAINS,
    loading: enabled && query.isPending,
    error: enabled ? query.error : null,
    refetch: query.refetch,
  };
}
