'use client';

import { useSustainmentDomains } from './useSustainmentDomains';
import { useDomains } from '@/hooks/domainData';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import { fetchExplorerData } from '@/Function/sync/explorerData';
import { initiativesForObjects, domainsForObjects, type InitiativeRelation } from '@/Function/domain/domainRelations';
import { readAllIn, readAllPages } from './readAllPages';
import type { AlconObject, Domain } from '@/types/database';
import { onlyActiveObjects } from '@/Function/shared/objectArchive';

export async function fetchDomainOverview(domainId: string) {
  if (!domainId) throw new Error('Choose a Domain');
  // Read a fresh, explicitly scoped snapshot. Never use the explorer hook's
  // previous-Domain placeholder under the destination Domain's heading.
  const [{ data: domain, error }, explorer] = await Promise.all([
    supabase.from('domains').select('id,name,description,identifier,privacy,icon,color').eq('id', domainId).single(),
    fetchExplorerData(domainId),
  ]);
  if (error) throw error;
  if (!domain) throw new Error('Domain unavailable');
  const links = await readAllIn<{ strategy_id: string; object_id: string }>('Domain Strategy links', explorer.objects.map(object => object.id),
    (ids, from, to) => supabase.from('strategy_objects').select('strategy_id,object_id', { count: 'exact' }).in('object_id', ids).order('strategy_id').order('object_id').range(from, to),
    link => `${link.strategy_id}:${link.object_id}`);
  const initiatives = await readAllIn<InitiativeRelation['initiative']>('Domain Strategies', links.map(link => link.strategy_id),
    (ids, from, to) => supabase.from('strategies').select('id,name,description,status', { count: 'exact' }).in('id', ids).order('id').range(from, to),
    initiative => initiative.id);
  return {
    domain: domain as Pick<Domain, 'id' | 'name' | 'description' | 'identifier' | 'privacy' | 'icon' | 'color'>,
    // Unassigned root Elements have no Domain association in the RPC.
    explorer: { ...explorer, rootElements: [] },
    initiatives: initiativesForObjects(explorer.objects.map(object => object.id), initiatives, links),
  };
}

export function useDomainOverview(domainId: string | null) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: ['domain-overview', userId, domainId],
    queryFn: () => fetchDomainOverview(domainId!),
    enabled: Boolean(userId && domainId),
    staleTime: 0, gcTime: 60_000,
  });
}

export async function fetchInitiativeDomains(initiativeId: string, viewableDomainIds: readonly string[]) {
  const { error } = await supabase.from('strategies').select('id').eq('id', initiativeId).single();
  if (error) throw error;
  const links = await readAllPages<{ object_id: string }>('Strategy Object links', (from, to) => supabase.from('strategy_objects')
    .select('object_id', { count: 'exact' }).eq('strategy_id', initiativeId).order('object_id').range(from, to), link => link.object_id);
  const objects = await readAllIn<Pick<AlconObject, 'id' | 'name' | 'domain_id'>>('Strategy Objects', links.map(link => link.object_id),
    (ids, from, to) => onlyActiveObjects(supabase.from('objects').select('id,name,domain_id', { count: 'exact' }).in('id', ids)).order('id').range(from, to), object => object.id);
  const homes = await readAllIn<{ object_id: string; domain_id: string }>('Object Domains', objects.map(object => object.id),
    (ids, from, to) => supabase.from('object_domains').select('object_id,domain_id', { count: 'exact' }).in('object_id', ids).order('object_id').order('domain_id').range(from, to), link => `${link.object_id}:${link.domain_id}`);
  const scope = new Set(viewableDomainIds);
  const domainIds = [...homes.map(home => home.domain_id), ...objects.flatMap(object => object.domain_id ? [object.domain_id] : [])].filter(id => scope.has(id));
  const domains = await readAllIn<Pick<Domain, 'id' | 'name' | 'description'>>('Strategy Domains', domainIds,
    (ids, from, to) => supabase.from('domains').select('id,name,description', { count: 'exact' }).in('id', ids).order('id').range(from, to), domain => domain.id);
  return domainsForObjects(objects, domains, homes);
}

export function useInitiativeDomains(initiativeId: string | null) {
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const spaceDomains = useSustainmentDomains();
  const memberDomains = useDomains();
  const domainIds = [...new Set([...spaceDomains.data, ...memberDomains.guestDomains].map(domain => domain.id))].sort();
  const sourceError = spaceDomains.error ?? memberDomains.error;
  const sourceLoading = spaceDomains.loading || memberDomains.loading;
  const query = useQuery({
    queryKey: ['initiative-domains', userId, spaceId, initiativeId, domainIds],
    queryFn: () => fetchInitiativeDomains(initiativeId!, domainIds),
    enabled: Boolean(userId && initiativeId && !sourceLoading && !sourceError),
    staleTime: 0, gcTime: 60_000,
  });
  const error = sourceError ?? query.error;
  return {
    data: sourceLoading || sourceError ? undefined : query.data,
    isPending: !error && (sourceLoading || query.isPending),
    isError: Boolean(error),
    error,
    refetch: async () => {
      await Promise.all([spaceDomains.refetch(), memberDomains.refetch()]);
      return query.refetch();
    },
  };
}
