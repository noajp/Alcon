'use client';

import { useMemo, useState } from 'react';
import { useCurrentUserId } from '@/providers/authContext';
import { useDomains } from '@/hooks/useSupabase';
import { useNowWork } from '@/hooks/useNowWork';
import { setActiveDomainId } from '@/alcon/domain/domainsStore';
import { ElementDetailView } from '@/alcon/element/ElementDetailView';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { Button } from '@/ui/button';
import type { ElementWithDetails } from '@/types/database';
import type { NavigationState } from '@/types/navigation';
import { buildNowItems, localWorkDate, type NowScope } from './nowModel';
import { NowView } from './NowView';
import { WorkImportFlow } from './WorkImportFlow';
import { CheckInDialog } from './CheckInDialog';

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
  const userId = useCurrentUserId();
  const { data, loading, refreshing, error, refetch } = useNowWork(spaceId);
  const { data: allDomains } = useDomains();
  const domains = allDomains.filter(domain => domain.activity_space_id === spaceId);
  const [scope, setScope] = useState<NowScope>('mine');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ElementWithDetails | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const today = localWorkDate(new Date());
  const items = useMemo(() => buildNowItems(data.elements, data.edges, userId ?? "", scope, today), [data, userId, scope, today]);
  const detail = data.elements.find(element => element.id === detailId);
  const refresh = () => { void refetch().catch(() => {}); };
  const openObject = (objectId: string) => {
    const domainId = data.objects.find(object => object.id === objectId)?.domain_id;
    if (domainId) setActiveDomainId(domainId);
    onNavigate({ objectId }); onViewChange?.('objects');
  };

  if (loading) return <div role="status" className="flex-1 p-8 text-[13px] text-muted-foreground">Loading current work…</div>;

  return <>
    {detail ? <ElementDetailView key={detail.id} element={detail} coordinationSpaceId={spaceId}
      domainName={domains.find(domain => domain.id === data.objects.find(object => object.id === detail.object_id)?.domain_id)?.name}
      onBack={() => setDetailId(null)} onNavigateRoot={() => setDetailId(null)} onRefresh={refresh}
      onOpenElement={setDetailId} onNavigateObject={openObject}
      onOpenStrategy={strategyId => { onNavigate({ strategyId }); onViewChange?.('strategy'); }} />
      : detailId ? <div className="p-8"><p role="alert" className="text-[13px] text-muted-foreground">This Element is no longer available in this Space.</p>
        <Button className="mt-3" onClick={() => setDetailId(null)}>Back to Now</Button></div>
        : <NowView items={items} scope={scope} onScopeChange={setScope} readAt={data.readAt} refreshing={refreshing}
          error={error?.message ?? null} onRefresh={refresh} onImport={() => setImportOpen(true)}
          onOpenElement={element => setDetailId(element.id)} onCheckIn={setEditing}
          onPersonalWork={() => onViewChange?.('my-elements')} />}
    {editing && <CheckInDialog element={data.elements.find(element => element.id === editing.id) ?? editing}
      onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    {importOpen && spaceId && <Dialog open>
      <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl"
        onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => event.preventDefault()}>
        <DialogTitle>Bring existing work</DialogTitle>
        <DialogDescription>Start with one project. Review its data and bring it into the team’s daily work.</DialogDescription>
        <WorkImportFlow spaceId={spaceId} data={data} domains={domains} onCancel={() => setImportOpen(false)}
          onDone={() => { setImportOpen(false); setScope('team'); refresh(); }} />
      </DialogContent>
    </Dialog>}
  </>;
}
