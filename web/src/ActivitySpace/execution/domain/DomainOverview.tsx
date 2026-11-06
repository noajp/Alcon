'use client';

import { useDomainOverview } from '@/hooks/useDomainOverview';
import { useBoard, WidgetSurface, WidgetZone, type WidgetHost } from '@/Function/widget';
import { DOMAIN_OVERVIEW_BOARD } from '@/Function/widget/defaults';
import { DomainIcon, ElementIcon, ObjectIcon } from '@/Function/shared/conceptIcons';
import { Hash, Lock, Users } from '@/ui/icons';
import { Button } from '@/ui/button';
import { PageHead, PageLayout } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { NavStrategyIcon } from '@/Frame/sidebar/NavIcons';
import { updateDomain, useDomainRole } from '@/hooks/domainData';
import type { NavigationState } from '@/types/navigation';
import { ViewOnlyBadge } from '@/Function/shared/ViewOnlyBadge';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ItemIconButton, useItemLook } from '@/Function/shared/itemIcon/IconPicker';
import type { Domain } from '@/types/database';

/** The Domain's Overview tab, under the Domain page's header and tabs
 *  (DomainView): no header of its own, and "Add widget" goes to the tab bar. */
export function DomainOverview({ domainId, onNavigate, onViewChange }: {
  domainId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange?: (view: string) => void;
}) {
  const { t } = useI18n();
  const query = useDomainOverview(domainId);
  const role = useDomainRole(domainId);
  const board = useBoard('domain-overview', DOMAIN_OVERVIEW_BOARD, domainId ?? 'none');
  if (!domainId) return <p className="p-8 text-sm text-muted-foreground">{t('Choose a Domain from the sidebar.')}</p>;
  if (query.isPending) return <p role="status" className="p-8 text-sm text-muted-foreground">{t('Loading Domain…')}</p>;
  if (!query.data) return <div role="alert" className="space-y-3 p-8 text-sm"><p>{t('Unable to load this Domain.')}</p><Button onClick={() => void query.refetch()}>{t('Retry')}</Button></div>;
  const { domain, explorer, initiatives } = query.data;
  // A Domain viewer reads the board; its widgets suspend writes.
  const viewOnly = role.data === 'viewer';
  const elements = [...new Map(explorer.objects.flatMap(object => object.elements ?? []).map(element => [element.id, element])).values()];
  const host: WidgetHost = {
    subject: { kind: 'domain', id: domain.id }, elements, explorerData: explorer, readOnly: query.isError || viewOnly,
    onRefresh: () => { void query.refetch(); },
    onNavigate: nav => {
      if (nav.objectId) { onNavigate({ objectId: nav.objectId, objectDomainId: domain.id }); onViewChange?.('objects'); }
      else if (nav.strategyId) { onNavigate({ strategyId: nav.strategyId }); onViewChange?.('strategy'); }
    },
    onViewChange,
  };
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
    {viewOnly && <div className="flex justify-end px-4 pt-2"><ViewOnlyBadge /></div>}
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageLayout rail={
        <RailCard title={t('Properties')}>
          <RailRow icon={domain.privacy === 'private' ? <Lock className="size-3.5 text-muted-foreground" /> : <Users className="size-3.5 text-muted-foreground" />}
            name={t('Access')} label={domain.privacy === 'private' ? t('Private') : 'Space'} dense />
          {domain.identifier && <RailRow icon={<Hash className="size-3.5 text-muted-foreground" />} name={t('Identifier')} label={domain.identifier} dense />}
          <button type="button" className="w-full" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('objects'); }}>
            <RailRow icon={<ObjectIcon size={14} />} name="Objects" label={String(explorer.objects.length)} dense />
          </button>
          <button type="button" className="w-full" onClick={() => { onNavigate({ objectId: null }); onViewChange?.('domain-elements'); }}>
            <RailRow icon={<ElementIcon size={14} />} name="Elements" label={String(elements.length)} dense />
          </button>
          <RailRow icon={<NavStrategyIcon size={14} />} name="Strategies" label={String(initiatives.length)} placeholder={initiatives.length === 0} dense />
        </RailCard>
      }>
        {query.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm"><p>{t('Unable to refresh this Domain. Showing the last loaded data; drafts are retained.')}</p><Button variant="ghost" onClick={() => void query.refetch()}>{t('Retry')}</Button></div>}
        {/* The spine — icon, title, description — is what Element detail opens
            with; the Domain's own readings and relationships sit below it, its
            facts in the island on the right. */}
        <PageHead key={`head-${domain.id}`} icon={<DomainLookButton domain={domain} canEdit={role.data === 'owner' || role.data === 'admin'} onSaved={() => void query.refetch()} />} title={domain.name} description={domain.description ?? ''}
          canEdit={role.data === 'owner' || role.data === 'admin'}
          titleLabel={t('Domain name')} titlePlaceholder={t('Domain name…')}
          descriptionLabel={t('Description')} descriptionPlaceholder={t('What this Domain is for…')}
          emptyDescription={t('No description yet.')}
          onSaveTitle={async (name) => { await updateDomain(domain.id, { name }); await query.refetch(); }}
          onSaveDescription={async (description) => { await updateDomain(domain.id, { description: description || null }); await query.refetch(); }} />
        <WidgetSurface key={`board-${domain.id}`} board={board} host={host} zones={['main']}>
          <WidgetZone zone="main" columns={1} />
        </WidgetSurface>
      </PageLayout>
    </div>
  </div>;
}

/** The Domain's icon and colour at the head of its page, picked as a
 *  Strategy's or Object's is; the sidebar shows the same mark. */
function DomainLookButton({ domain, canEdit, onSaved }: { domain: Pick<Domain, 'id' | 'icon' | 'color'>; canEdit: boolean; onSaved: () => void }) {
  const [look, change] = useItemLook({ icon: domain.icon ?? null, color: domain.color ?? null },
    async (next) => { await updateDomain(domain.id, { icon: next.icon, color: next.color }); onSaved(); });
  return <ItemIconButton value={look} onChange={change} canEdit={canEdit} defaultIcon={<DomainIcon size={18} />} />;
}
