'use client';

import { useDomainOverview } from '@/hooks/useDomainOverview';
import { useBoard, WidgetSurface, WidgetZone, type WidgetHost } from '@/Function/widget';
import { DOMAIN_OVERVIEW_BOARD } from '@/Function/widget/defaults';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { Button } from '@/ui/button';
import type { NavigationState } from '@/types/navigation';

export function DomainOverview({ domainId, onNavigate, onViewChange }: {
  domainId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const query = useDomainOverview(domainId);
  const board = useBoard('domain-overview', DOMAIN_OVERVIEW_BOARD, domainId ?? 'none');
  if (!domainId) return <p className="p-8 text-sm text-muted-foreground">Choose a Domain from the sidebar.</p>;
  if (query.isPending) return <p role="status" className="p-8 text-sm text-muted-foreground">Loading Domain…</p>;
  if (!query.data) return <div role="alert" className="space-y-3 p-8 text-sm"><p>Unable to load this Domain.</p><Button onClick={() => void query.refetch()}>Retry</Button></div>;
  const { domain, explorer, initiatives } = query.data;
  const elements = [...new Map(explorer.objects.flatMap(object => object.elements ?? []).map(element => [element.id, element])).values()];
  const host: WidgetHost = {
    subject: { kind: 'domain', id: domain.id }, elements, explorerData: explorer, readOnly: query.isError,
    onRefresh: () => { void query.refetch(); },
    onNavigate: nav => {
      if (nav.objectId) { onNavigate({ objectId: nav.objectId, objectDomainId: domain.id }); onViewChange?.('objects'); }
      else if (nav.strategyId) { onNavigate({ strategyId: nav.strategyId }); onViewChange?.('strategy'); }
      // The supply widget opens SCM on this Domain's supply.
      else if (nav.scmView) onNavigate({ scmView: nav.scmView, scmNode: nav.scmNode ?? null, scmScope: nav.scmScope ?? null, scmLocationId: nav.scmLocationId ?? null });
    },
    onViewChange,
  };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
    <header className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
      <DomainIcon size={12} />
      <h1 className="truncate text-xs font-semibold">{domain.name}</h1>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-6">
      {query.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><p>Unable to refresh this Domain. Showing the last loaded data; drafts are retained.</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>}
      <section className="space-y-3" aria-label="Domain details">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><DomainIcon size={16} />Domain<span>·</span><span>{domain.privacy === 'private' ? 'Private' : 'Space'}</span>{domain.identifier && <span>{domain.identifier}</span>}</div>
        <p className="max-w-3xl whitespace-pre-wrap break-words text-sm text-muted-foreground">{domain.description || 'No description yet.'}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button variant="secondary" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('objects'); }}>{explorer.objects.length} Objects</Button>
          <Button variant="ghost" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('domain-elements'); }}>{elements.length} Elements</Button>
          <span>{initiatives.length} Initiatives linked through Objects</span>
        </div>
      </section>
      <WidgetSurface key={domain.id} board={board} host={host} zones={['main']}>
        <WidgetZone zone="main" columns={1} />
      </WidgetSurface>
    </div>
  </div>;
}
