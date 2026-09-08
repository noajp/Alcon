'use client';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUserId } from '@/providers/authContext';
import { useSustainmentDomains } from './useSustainmentDomains';
import { useDomains } from '@/ActivitySpace/execution/domain/data';
import { supabase } from '@/lib/supabase';
import { readAllPages } from './readAllPages';
import { chunkIds } from './chunkedIn';

type Reference = { id: string; domain_id: string; title: string; expected_change: string };
export function useApproachReferences(kind: 'initiative' | 'object', id: string | null) {
  const userId = useCurrentUserId();
  const spaceDomains = useSustainmentDomains();
  const domains = useDomains();
  const visible = [...new Map([...spaceDomains.data, ...domains.guestDomains].map(d => [d.id, d])).values()];
  const sourceError = spaceDomains.error ?? domains.error;
  const sourceLoading = spaceDomains.loading || domains.loading;
  const query = useQuery({
    queryKey: ['approach-references', userId, kind, id, visible.map(d => d.id).sort()],
    enabled: Boolean(userId && id && !sourceLoading && !sourceError),
    queryFn: async () => {
      let approachIds: string[] = [];
      if (kind === 'object') {
        const links = await readAllPages<{ id: string; approach_id: string }>('Object contributions', (from, to) => supabase.from('approach_contributions').select('id,approach_id', { count: 'exact' }).eq('object_id', id!).order('id').range(from, to), r => r.id);
        approachIds = [...new Set(links.map(r => r.approach_id))];
      }
      const rows: Reference[] = [];
      for (const ids of chunkIds(kind === 'object' ? approachIds : [id!])) rows.push(...await readAllPages<Reference>('Approach references', (from, to) => supabase.from('domain_approaches').select('id,domain_id,title,expected_change', { count: 'exact' }).in(kind === 'object' ? 'id' : 'strategy_id', ids).order('id').range(from, to), r => r.id));
      return rows.flatMap(r => { const domain = visible.find(d => d.id === r.domain_id); return domain ? [{ ...r, domainName: domain.name }] : []; });
    },
    staleTime: 0,
  });
  return { ...query, data: sourceError || sourceLoading ? undefined : query.data, isError: Boolean(sourceError) || query.isError,
    isPending: !sourceError && (sourceLoading || query.isPending), refetch: async () => { await Promise.all([spaceDomains.refetch(), domains.refetch()]); return query.refetch(); } };
}
