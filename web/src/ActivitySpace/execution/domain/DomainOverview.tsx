'use client';

import { useDomainOverview } from '@/hooks/useDomainOverview';
import { useBoard, WidgetSurface, WidgetZone, WidgetActionSlotProvider, WidgetActionSlotTarget, type WidgetHost } from '@/Function/widget';
import { DOMAIN_OVERVIEW_BOARD } from '@/Function/widget/defaults';
import { DomainIcon, ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { Hash, Lock, Users } from 'lucide-react';
import { Button } from '@/ui/button';
import { PageHead, PageLayout } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
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
  return <WidgetActionSlotProvider><div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
    <header className="h-[50px] flex items-center gap-2 px-4 border-b border-border/60 bg-card flex-shrink-0">
      <DomainIcon size={12} />
      <span className="truncate text-xs font-semibold">{domain.name}</span>
      <div className="flex-1" />
      {/* "Add widget" is page chrome: it sits in the header, as on Element detail. */}
      <WidgetActionSlotTarget className="flex items-center gap-1" />
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageLayout rail={
        <RailCard title="Properties">
          <RailRow icon={domain.privacy === 'private' ? <Lock className="size-3.5 text-muted-foreground" /> : <Users className="size-3.5 text-muted-foreground" />}
            name="Access" label={domain.privacy === 'private' ? 'Private' : 'Space'} dense />
          {domain.identifier && <RailRow icon={<Hash className="size-3.5 text-muted-foreground" />} name="Identifier" label={domain.identifier} dense />}
          <button type="button" className="w-full" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('objects'); }}>
            <RailRow icon={<ObjectIcon size={14} />} name="Objects" label={String(explorer.objects.length)} dense />
          </button>
          <button type="button" className="w-full" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('domain-elements'); }}>
            <RailRow icon={<ElementIcon size={14} />} name="Elements" label={String(elements.length)} dense />
          </button>
          <RailRow icon={<NavStrategyIcon size={14} />} name="Initiatives" label={String(initiatives.length)} placeholder={initiatives.length === 0} dense />
        </RailCard>
      }>
        {query.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><p>Unable to refresh this Domain. Showing the last loaded data; drafts are retained.</p><Button variant="ghost" onClick={() => void query.refetch()}>Retry</Button></div>}
        {/* The spine — icon, title, description — is what Element detail opens
            with; the Domain's own readings and relationships sit below it, its
            facts in the island on the right. */}
        <PageHead key={`head-${domain.id}`} icon={<DomainIcon size={18} />} title={domain.name} description={domain.description ?? ''}
          canEdit={role.data === 'owner' || role.data === 'admin'}
          titleLabel="Domain name" titlePlaceholder="Domain name…"
          descriptionLabel="Description" descriptionPlaceholder="What this Domain is for…"
          emptyDescription="No description yet."
          onSaveTitle={async (name) => { await updateDomain(domain.id, { name }); await query.refetch(); }}
          onSaveDescription={async (description) => { await updateDomain(domain.id, { description: description || null }); await query.refetch(); }} />
        <WidgetSurface key={`board-${domain.id}`} board={board} host={host} zones={['main']}>
          <WidgetZone zone="main" columns={1} />
        </WidgetSurface>
      </PageLayout>
    </div>
  </div></WidgetActionSlotProvider>;
}
