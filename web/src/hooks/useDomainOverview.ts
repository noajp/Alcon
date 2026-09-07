'use client';

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useCurrentUserId } from '@/providers/authContext';
import { fetchExplorerData } from '@/alcon/sync/explorerData';
import { initiativesForObjects, domainsForObjects, type InitiativeRelation } from '@/alcon/domain/domainRelations';
import { chunkIds } from './chunkedIn';
import { readAllPages, type CountedRows } from './readAllPages';
import type { AlconObject, Domain } from '@/types/database';

async function readIn<Row>(label: string, ids: string[], run: (ids: string[], from: number, to: number) => PromiseLike<CountedRows<Row>>, identity: (row: Row) => string) {
  const rows: Row[] = [];
  for (const chunk of chunkIds([...new Set(ids)])) rows.push(...await readAllPages(label, (from, to) => run(chunk, from, to), identity));
  return rows;
}

export async function fetchDomainOverview(domainId: string) {
  if (!domainId) throw new Error('Choose a Domain');
  // Read a fresh, explicitly scoped snapshot. Never use the explorer hook's
  // previous-Domain placeholder under the destination Domain's heading.
  const [{ data: domain, error }, explorer] = await Promise.all([
    supabase.from('domains').select('id,name,description,identifier,privacy').eq('id', domainId).single(),
    fetchExplorerData(domainId),
  ]);
  if (error) throw error;
  if (!domain) throw new Error('Domain unavailable');
  const links = await readIn<{ strategy_id: string; object_id: string }>('Domain Initiative links', explorer.objects.map(object => object.id),
    (ids, from, to) => supabase.from('strategy_objects').select('strategy_id,object_id', { count: 'exact' }).in('object_id', ids).order('strategy_id').order('object_id').range(from, to),
    link => `${link.strategy_id}:${link.object_id}`);
  const initiatives = await readIn<InitiativeRelation['initiative']>('Domain Initiatives', links.map(link => link.strategy_id),
    (ids, from, to) => supabase.from('strategies').select('id,name,description,status', { count: 'exact' }).in('id', ids).order('id').range(from, to),
    initiative => initiative.id);
  return {
    domain: domain as Pick<Domain, 'id' | 'name' | 'description' | 'identifier' | 'privacy'>,
    explorer,
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

export async function fetchInitiativeDomains(initiativeId: string) {
  const { error } = await supabase.from('strategies').select('id').eq('id', initiativeId).single();
  if (error) throw error;
  const links = await readAllPages<{ object_id: string }>('Initiative Object links', (from, to) => supabase.from('strategy_objects')
    .select('object_id', { count: 'exact' }).eq('strategy_id', initiativeId).order('object_id').range(from, to), link => link.object_id);
  const objects = await readIn<Pick<AlconObject, 'id' | 'name' | 'domain_id'>>('Initiative Objects', links.map(link => link.object_id),
    (ids, from, to) => supabase.from('objects').select('id,name,domain_id', { count: 'exact' }).in('id', ids).order('id').range(from, to), object => object.id);
  const homes = await readIn<{ object_id: string; domain_id: string }>('Object Domains', objects.map(object => object.id),
    (ids, from, to) => supabase.from('object_domains').select('object_id,domain_id', { count: 'exact' }).in('object_id', ids).order('object_id').order('domain_id').range(from, to), link => `${link.object_id}:${link.domain_id}`);
  const domainIds = [...homes.map(home => home.domain_id), ...objects.flatMap(object => object.domain_id ? [object.domain_id] : [])];
  const domains = await readIn<Pick<Domain, 'id' | 'name' | 'description'>>('Initiative Domains', domainIds,
    (ids, from, to) => supabase.from('domains').select('id,name,description', { count: 'exact' }).in('id', ids).order('id').range(from, to), domain => domain.id);
  return domainsForObjects(objects, domains, homes);
}

export function useInitiativeDomains(initiativeId: string | null) {
  const userId = useCurrentUserId();
  return useQuery({
    queryKey: ['initiative-domains', userId, initiativeId],
    queryFn: () => fetchInitiativeDomains(initiativeId!),
    enabled: Boolean(userId && initiativeId),
    staleTime: 0, gcTime: 60_000,
  });
}
