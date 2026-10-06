'use client';

import { useDomainOverview } from '@/hooks/useDomainOverview';
import { useBoard, WidgetSurface, WidgetZone, type WidgetHost } from '@/Function/widget';
import { DOMAIN_OVERVIEW_BOARD } from '@/Function/widget/defaults';
import { DomainIcon } from '@/Function/shared/conceptIcons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { PAGE_BODY, PageHead } from '@/Function/shared/PageHead';
import { updateDomain, useDomainRole } from './data';
import type { NavigationState } from '@/types/navigation';

export function DomainOverview({ domainId, onNavigate, onViewChange }: {
  domainId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const query = useDomainOverview(domainId);
  const role = useDomainRole(domainId);
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
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={`${PAGE_BODY} flex flex-col gap-6`}>
        {query.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><p>Unable to refresh this Domain. Showing the last loaded data; drafts are retained.</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>}
        {/* The spine — title, then description — is what Element detail opens
            with; the Domain's own readings and relationships sit below it. */}
        <PageHead key={domain.id} title={domain.name} description={domain.description ?? ''}
          canEdit={role.data === 'owner' || role.data === 'admin'}
          titleLabel="Domain name" titlePlaceholder="Domain name…"
          descriptionLabel="Description" descriptionPlaceholder="What this Domain is for…"
          emptyDescription="No description yet."
          onSaveTitle={async (name) => { await updateDomain(domain.id, { name }); await query.refetch(); }}
          onSaveDescription={async (description) => { await updateDomain(domain.id, { description: description || null }); await query.refetch(); }} />
        <ButtonAppearanceProvider appearance="inline">
          <div className="-mt-3 -ml-2.5 flex flex-wrap items-center gap-0.5 text-[13px] text-muted-foreground">
            <Button variant="ghost" size="sm" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('objects'); }}>{explorer.objects.length} Objects</Button>
            <Button variant="ghost" size="sm" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('domain-elements'); }}>{elements.length} Elements</Button>
            <span className="px-2.5">{initiatives.length} Initiatives linked through Objects</span>
            <span aria-hidden>·</span>
            <span className="px-2.5">{domain.privacy === 'private' ? 'Private' : 'Space'}{domain.identifier ? ` · ${domain.identifier}` : ''}</span>
          </div>
        </ButtonAppearanceProvider>
        <WidgetSurface key={domain.id} board={board} host={host} zones={['main']}>
          <WidgetZone zone="main" columns={1} />
        </WidgetSurface>
      </div>
    </div>
  </div>;
}
