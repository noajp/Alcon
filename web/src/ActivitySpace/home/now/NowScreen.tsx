'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUserId } from '@/providers/authContext';
import { useDomains } from '@/hooks/useSupabase';
import { useNowWork } from '@/hooks/useNowWork';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { getActiveDomainId } from '@/Function/space/domainsStore';
import { getActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { fetchObjectDomainIds } from '@/hooks/objectData';
import { objectDomainRoute } from '@/shell/navigationState';
import { ElementDetailView } from '@/ActivitySpace/execution/element/ElementDetailView';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import type { ElementWithDetails } from '@/types/database';
import type { NavigationState } from '@/types/navigation';
import { buildNowItems, localWorkDate, type NowScope } from './nowModel';
import { NowView } from './NowView';
import { WorkImportFlow } from './WorkImportFlow';
import { CheckInDialog } from './CheckInDialog';
import { useI18n } from '@/Function/i18n/I18nProvider';

interface NowScreenProps {
  spaceId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}

export function NowScreen(props: NowScreenProps) {
  const userId = useCurrentUserId();
  return <NowSession key={`${userId}:${props.spaceId}`} {...props} />;
}

function NowSession({ spaceId, onNavigate, onViewChange }: NowScreenProps) {
  const { t } = useI18n();
  const userId = useCurrentUserId();
  const { data, loading, refreshing, error, refetch } = useNowWork(spaceId);
  const { data: allDomains, guestDomains } = useDomains();
  const { data: spaceDomains } = useSustainmentDomains();
  const domains = allDomains.filter(domain => domain.activity_space_id === spaceId);
  const visibleDomains = [...spaceDomains.filter(domain => domain.activity_space_id === spaceId), ...guestDomains];
  const [scope, setScope] = useState<NowScope>('mine');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const navigationRequest = useRef(0);
  useEffect(() => () => { navigationRequest.current += 1; }, [detailId]);
  const [editing, setEditing] = useState<ElementWithDetails | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const today = localWorkDate(new Date());
  const items = useMemo(() => buildNowItems(data.elements, data.edges, userId ?? "", scope, today), [data, userId, scope, today]);
  const detail = data.elements.find(element => element.id === detailId);
  const refresh = () => { void refetch().catch(() => {}); };
  const openDetail = (elementId: string | null) => {
    navigationRequest.current += 1;
    setNavigationError(null);
    setDetailId(elementId);
  };
  const openObject = (objectId: string) => {
    const request = ++navigationRequest.current;
    setNavigationError(null);
    void fetchObjectDomainIds(objectId).then(domainIds => {
      if (request !== navigationRequest.current || getActiveSpaceId() !== spaceId) return;
      const domainId = objectDomainRoute(domainIds, visibleDomains.map(domain => domain.id), getActiveDomainId());
      if (!domainId) throw new Error(t('This Object has no accessible Domain in the current Space or your shared Domains.'));
      onNavigate({ objectId, objectDomainId: domainId });
      onViewChange?.('objects');
    }).catch(error => {
      if (request === navigationRequest.current && getActiveSpaceId() === spaceId) {
        setNavigationError(error instanceof Error ? error.message : t('Could not open this Object. Try again.'));
      }
    });
  };

  if (loading) return <div role="status" className="flex-1 p-8 text-[13px] text-muted-foreground">{t('Loading current work…')}</div>;

  return <>
    {navigationError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{navigationError}</p>}
    {detail ? <ElementDetailView key={detail.id} element={detail} coordinationSpaceId={spaceId}
      domainName={visibleDomains.find(domain => domain.id === data.objects.find(object => object.id === detail.object_id)?.domain_id)?.name}
      onBack={() => openDetail(null)} onNavigateRoot={() => openDetail(null)} onRefresh={refresh}
      onOpenElement={openDetail} onNavigateObject={openObject}
      onOpenStrategy={strategyId => { navigationRequest.current += 1; onNavigate({ strategyId }); onViewChange?.('strategy'); }} />
      : detailId ? <div className="p-8"><p role="alert" className="text-[13px] text-muted-foreground">{t('This Element is no longer available in this Space.')}</p>
        <Button className="mt-3" onClick={() => openDetail(null)}>{t('Back to Now')}</Button></div>
        : <NowView items={items} scope={scope} onScopeChange={setScope} readAt={data.readAt} refreshing={refreshing}
          error={error?.message ?? null} onRefresh={refresh} onImport={() => setImportOpen(true)}
          onOpenElement={element => openDetail(element.id)} onCheckIn={setEditing}
          onPersonalWork={() => onViewChange?.('my-elements')} />}
    {editing && <CheckInDialog element={data.elements.find(element => element.id === editing.id) ?? editing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    {importOpen && spaceId && <Dialog open>
      <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl"
        onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
        <DialogTitle>{t('Bring existing work')}</DialogTitle>
        <DialogDescription>{t('Start with one project. Review its data and bring it into the team’s daily work.')}</DialogDescription>
        <WorkImportFlow spaceId={spaceId} data={data} domains={domains} onCancel={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); setScope('team'); refresh(); }} />
      </DialogContent>
    </Dialog>}
  </>;
}
