'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useDomains } from '@/alcon/domain/data';
import { useActiveSpaceId } from '@/alcon/space/activeSpaceStore';
import { fetchExplorerData } from '@/alcon/sync/explorerData';
import { useCurrentUserId } from '@/providers/authContext';
import { selectWorkloadElements, workloadDomainIds, type WorkloadSelection } from './workloadModel';

export interface WorkloadScope {
  domainIds?: string[];
  objectIds?: string[];
}

/** Workload observes the same Domain explorer entries as Execution. Optimistic
 * edits and confirmed deltas therefore update both surfaces through one cache. */
export function useWorkloadData(scopeOverride?: WorkloadScope) {
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  const contextKey = JSON.stringify([userId, spaceId]);
  const domainQuery = useDomains();
  const domains = useMemo(() => [...new Map([
    ...domainQuery.data.filter(domain => !spaceId || domain.activity_space_id === spaceId),
    ...domainQuery.guestDomains,
  ].map(domain => [domain.id, domain])).values()], [domainQuery.data, domainQuery.guestDomains, spaceId]);
  const [selection, setSelection] = useState<WorkloadSelection>({ contextKey, domainIds: null });
  const accessibleIds = domains.map(domain => domain.id);
  const selectedDomainIds = workloadDomainIds(selection, contextKey, accessibleIds);
  const setSelectedDomainIds = (update: (previous: string[]) => string[]) => {
    setSelection(previous => ({
      contextKey,
      domainIds: update(workloadDomainIds(previous, contextKey, accessibleIds)),
    }));
  };
  const domainIds = scopeOverride
    ? (scopeOverride.domainIds ?? []).filter(id => accessibleIds.includes(id))
    : selectedDomainIds;
  const objectIds = scopeOverride?.objectIds ?? [];
  // Object-only tabs need the visible Domain trees to resolve the Object's
  // multi-homing. No global explorer query can silently cross a Space boundary.
  const readDomainIds = objectIds.length > 0 ? accessibleIds : domainIds;
  const explorers = useQueries({ queries: readDomainIds.map(id => ({
    queryKey: ['explorer', id],
    queryFn: () => fetchExplorerData(id),
    enabled: Boolean(userId),
  })) });
  const elements = selectWorkloadElements(explorers.flatMap((query, index) => query.data
    ? [{ domainId: readDomainIds[index], data: query.data }] : []), domainIds, objectIds);
  const loading = domainQuery.loading || Boolean(userId && explorers.some(query => query.isPending));
  const error = domainQuery.error ?? explorers.find(query => query.error)?.error ?? null;
  const retry = useCallback(async () => {
    await Promise.all([domainQuery.refetch(), ...explorers.map(query => query.refetch())]);
  }, [domainQuery, explorers]);

  return { contextKey, domains, selectedDomainIds, setSelectedDomainIds, elements, loading, error, retry };
}
