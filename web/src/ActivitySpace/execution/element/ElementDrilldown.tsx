'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ElementDetailView } from '@/ActivitySpace/execution/element/ElementDetailView';
import { fetchElementWithDetails } from '@/ActivitySpace/execution/element/data';
import { fetchObjectDomainIds } from '@/ActivitySpace/execution/object/data';
import { getActiveDomainId } from '@/ActivitySpace/execution/domain/domainsStore';
import { useDomains } from '@/ActivitySpace/execution/domain/data';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { objectDomainRoute } from '@/shell/navigationState';
import { useCurrentUserId } from '@/providers/authContext';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';

interface Props {
  label: string;
  children: (openElement: (id: string) => void) => ReactNode;
  onNavigate?: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
  /** Named on the breadcrumb root, so a detail opened from a tool says where
   *  it came back to. Without it the root reads "Back" and the Element floats
   *  free of the Domain it belongs to. */
  domainName?: string | null;
}

/** Keep a tool's filters and scroll position while editing the actual Element. */
export function ElementDrilldown(props: Props) {
  const userId = useCurrentUserId();
  const spaceId = useActiveSpaceId();
  return <Drilldown key={`${userId}:${spaceId}`} {...props} />;
}

function Drilldown({ label, children, onNavigate, onViewChange, domainName }: Props) {
  const { t } = useI18n();
  const [elementId, setElementId] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const { data: domains } = useSustainmentDomains();
  const { guestDomains } = useDomains();
  const navigationRequest = useRef(0);
  useEffect(() => () => { navigationRequest.current += 1; }, [elementId]);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ['element-detail', elementId],
    enabled: !!elementId,
    queryFn: () => fetchElementWithDetails(elementId!),
  });
  const back = () => { setElementId(null); setNavigationError(null); };
  const refresh = async () => {
    await Promise.all([
      query.refetch(),
      qc.invalidateQueries({ queryKey: ['explorer'] }),
      qc.invalidateQueries({ queryKey: ['my-elements'] }),
      qc.invalidateQueries({ queryKey: ['worker-commitments'] }),
      qc.invalidateQueries({ queryKey: ['team-roster'] }),
    ]);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      {elementId && (query.data ? (
        <>
          {navigationError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{navigationError}</p>}
          <ElementDetailView
            key={elementId}
            element={query.data}
            objectPath={query.data.objects ?? []}
            domainName={domainName}
            onBack={back}
            onNavigateRoot={back}
            onRefresh={refresh}
            onNavigateObject={onNavigate && onViewChange ? (objectId) => {
              const request = ++navigationRequest.current;
              void fetchObjectDomainIds(objectId).then(domainIds => {
                if (request !== navigationRequest.current) return;
                const domainId = objectDomainRoute(domainIds, [...domains, ...guestDomains].map(domain => domain.id), getActiveDomainId());
                if (!domainId) throw new Error(t('This Object has no accessible Domain in the current Space or your shared Domains.'));
                onNavigate({ objectId, objectDomainId: domainId });
                onViewChange('objects');
              }).catch(error => {
                if (request === navigationRequest.current) setNavigationError(error instanceof Error ? error.message : t('Could not open this Object. Try again.'));
              });
            } : undefined}
            onOpenStrategy={onNavigate && onViewChange ? (strategyId) => {
              onNavigate({ strategyId });
              onViewChange('strategy');
            } : undefined}
          />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <p role={query.error ? 'alert' : 'status'}>{query.isPending ? t('Opening Element…') : t('This Element could not be loaded.')}</p>
          {!query.isPending && <Button size="sm" onClick={() => void query.refetch()}>{t('Retry')}</Button>}
          <Button size="sm" onClick={back}>{t('Back to {label}', { label })}</Button>
        </div>
      ))}
      <div className={elementId ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        {children(id => { setNavigationError(null); setElementId(id); })}
      </div>
    </div>
  );
}
