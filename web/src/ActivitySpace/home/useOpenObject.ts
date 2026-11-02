'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDomains } from '@/hooks/useSupabase';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { fetchObjectDomainIds } from '@/hooks/objectData';
import { getActiveDomainId } from '@/Function/space/domainsStore';
import { getActiveSpaceId, useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { objectDomainRoute } from '@/shell/navigationState';
import type { NavigationState } from '@/types/navigation';

/**
 * Opens an Object in a Domain it belongs to. Navigating by objectId alone
 * leaves the shell on whichever Domain is active, so an Object from another
 * Domain opens under the wrong breadcrumb (and is missing from that Domain's
 * list until it loads on its own). This looks the Object's Domains up first
 * and switches to one the viewer can see — the active one when the Object is
 * in it. Resolves to false when no visible Domain holds the Object; a newer
 * call, or a Space switch in between, drops the older one silently.
 */
export function useOpenObject({ onNavigate, onViewChange }: {
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const spaceId = useActiveSpaceId();
  const { guestDomains } = useDomains();
  const { data: spaceDomains } = useSustainmentDomains();
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);

  const visibleIds = useMemo(() => [
    ...spaceDomains.filter(domain => domain.activity_space_id === spaceId).map(domain => domain.id),
    ...guestDomains.map(domain => domain.id),
  ], [spaceDomains, guestDomains, spaceId]);

  return useCallback(async (objectId: string): Promise<boolean> => {
    const mine = ++request.current;
    const space = getActiveSpaceId();
    const domainIds = await fetchObjectDomainIds(objectId);
    if (mine !== request.current || getActiveSpaceId() !== space) return true;
    const domainId = objectDomainRoute(domainIds, visibleIds, getActiveDomainId());
    if (!domainId) return false;
    onNavigate?.({ objectId, objectDomainId: domainId });
    onViewChange?.('objects');
    return true;
  }, [onNavigate, onViewChange, visibleIds]);
}
