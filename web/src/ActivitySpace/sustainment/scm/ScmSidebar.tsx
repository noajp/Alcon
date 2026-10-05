'use client';

import { useMemo, useState, type ComponentType } from 'react';
import { AlertTriangle, Bot, Boxes, Layers, ScrollText, FlaskConical, LayoutDashboard, MapPin, Search, Settings2, ShoppingCart, Truck, Warehouse, X } from 'lucide-react';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useScmData, useScmPlan } from '@/hooks/useScm';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { scopeScmData, SPACE_SCOPE } from './scmScope';
import type { NavigationState } from '@/types/navigation';
import { SCM_VIEW_LABEL, scmViewOf, type ScmView } from './scmNavigation';
import type { ScmNode } from './scmEngine';
import { HEALTH_TONE } from './scmText';
import { Dot } from './ScmParts';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';

// The SCM sidebar is the App's map: where to go (with live counts, so the
// sidebar alone says where attention is needed), whose supply (a Domain's or
// the Space's) and which location everything is filtered to, a jump-to-item
// search, and the autopilot's state.

const ICONS: Record<ScmView, ComponentType<{ size?: number }>> = {
  tower: LayoutDashboard, exceptions: AlertTriangle, replenish: ShoppingCart, orders: Truck,
  inventory: Boxes, ledger: ScrollText, suppliers: Warehouse, scenarios: FlaskConical, settings: Settings2,
};
const PRIMARY: ScmView[] = ['tower', 'exceptions', 'replenish', 'orders'];
const SECONDARY: ScmView[] = ['inventory', 'ledger', 'suppliers', 'scenarios', 'settings'];


export function ScmSidebar({ navigation, onNavigate, onOpen }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  /** Make sure the main pane shows SCM. */
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: everything } = useScmData(spaceId);
  const { data: spaceDomains } = useSustainmentDomains();
  const scope = navigation.scmScope ?? null;
  const data = useMemo(() => everything ? scopeScmData(everything, scope) : null, [everything, scope]);
  const plan = useScmPlan(data);
  // Scopes worth offering: the Domains that hold supply records, and the one shown.
  const scopes = useMemo(() => {
    if (!everything) return [];
    const used = new Set<string>();
    for (const record of [...everything.locations, ...everything.suppliers, ...everything.items]) if (record.domainId) used.add(record.domainId);
    if (scope && scope !== SPACE_SCOPE) used.add(scope);
    if (!used.size) return [];
    const named = [...used].map(id => ({ id, name: spaceDomains.find(domain => domain.id === id)?.name ?? t('Unknown Domain') })).sort((a, b) => a.name.localeCompare(b.name));
    return [{ id: null as string | null, name: t('Everything') }, { id: SPACE_SCOPE as string | null, name: t('Shared by the Space') }, ...named];
  }, [everything, spaceDomains, scope, t]);
  const [query, setQuery] = useState('');
  const view = scmViewOf(navigation);
  const locationId = navigation.scmLocationId && data?.locations.some(location => location.id === navigation.scmLocationId) ? navigation.scmLocationId : null;
  const inItem = !!navigation.scmNode;

  const nodes = useMemo(() => plan?.nodes.filter(node => !locationId || node.locationId === locationId) ?? [], [plan, locationId]);
  const counts = useMemo(() => {
    if (!data || !plan) return null;
    const orders = data.orders.filter(order => !locationId || order.locationId === locationId);
    const open = orders.filter(order => ['approved', 'sent', 'partial'].includes(order.status));
    return {
      exceptions: nodes.filter(node => ['stockout', 'critical', 'reorder'].includes(node.health) || node.arrivals.some(arrival => arrival.overdue)).length,
      urgent: nodes.filter(node => node.health === 'stockout' || node.health === 'critical').length,
      replenish: plan.proposals.filter(proposal => !locationId || proposal.locationId === locationId).length,
      orders: open.length,
      overdue: open.filter(order => order.expectedOn < data.today).length,
      drafts: orders.filter(order => order.status === 'draft').length,
      inventory: nodes.length,
      suppliers: data.suppliers.length,
    };
  }, [data, plan, nodes, locationId]);
  const riskByLocation = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of plan?.nodes ?? []) if (node.health === 'stockout' || node.health === 'critical') map.set(node.locationId, (map.get(node.locationId) ?? 0) + 1);
    return map;
  }, [plan]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !plan) return [] as ScmNode[];
    return plan.nodes.filter(node => (!locationId || node.locationId === locationId) && (node.sku.toLowerCase().includes(needle) || node.name.toLowerCase().includes(needle))).slice(0, 8);
  }, [query, plan, locationId]);

  const go = (next: ScmView) => { onOpen(); onNavigate({ scmView: next, scmNode: null, scmHealth: null, scmSupplierDelay: null, scmLedgerItemId: null, scmCatalog: null }); };
  const badge = (id: ScmView) => {
    if (!counts) return null;
    if (id === 'exceptions' && counts.exceptions) return <span className={`text-[11px] tabular-nums ${counts.urgent ? 'text-[var(--status-danger)]' : 'text-muted-foreground/70'}`}>{counts.exceptions}</span>;
    if (id === 'replenish' && counts.replenish) return <span className="text-[11px] tabular-nums text-muted-foreground/70">{counts.replenish}</span>;
    if (id === 'orders' && (counts.orders || counts.drafts)) return <span className="flex items-center gap-1.5 text-[11px] tabular-nums">
      {counts.drafts > 0 && <span className="text-[var(--status-warning)]" title={t('Awaiting approval')}>{counts.drafts}</span>}
      <span className={counts.overdue ? 'text-[var(--status-danger)]' : 'text-muted-foreground/70'} title={counts.overdue ? t('{n} overdue', { n: counts.overdue }) : undefined}>{counts.orders}</span>
    </span>;
    if (id === 'inventory' && counts.inventory) return <span className="text-[11px] tabular-nums text-muted-foreground/70">{counts.inventory}</span>;
    if (id === 'suppliers' && counts.suppliers) return <span className="text-[11px] tabular-nums text-muted-foreground/70">{counts.suppliers}</span>;
    return null;
  };
  const navRow = (id: ScmView) => {
    const Icon = ICONS[id];
    const active = view === id && !inItem;
    return <SidebarRow key={id} active={active} icon={<Icon size={16} />} label={t(SCM_VIEW_LABEL[id])} meta={badge(id)} onClick={() => go(id)} />;
  };

  return <div className="mt-1 flex flex-col">
    <SidebarSectionLabel>SCM</SidebarSectionLabel>
    {data && data.items.length > 0 && <div className="relative mb-1 mt-1 px-0.5">
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
      <input aria-label={t('Find an item')} placeholder={t('Find an item…')} value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Escape') setQuery(''); if (event.key === 'Enter' && matches[0]) { onOpen(); onNavigate({ scmNode: matches[0].key }); setQuery(''); } }}
        className="h-7 w-full rounded-md bg-sidebar-accent/40 pl-7 pr-7 text-[12px] placeholder:text-muted-foreground/60 hover:bg-sidebar-accent/60 focus:bg-sidebar-accent" />
      {query && <button type="button" aria-label={t('Clear')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setQuery('')}><X size={12} /></button>}
    </div>}
    {query.trim() && <div className="mb-2 flex flex-col">
      {matches.map(node => <SidebarRow key={node.key} size="tall" active={navigation.scmNode === node.key} icon={<Dot tone={HEALTH_TONE[node.health]} />}
        label={<><span className="block truncate">{node.name}</span><span className="block truncate text-[11px] font-normal text-muted-foreground/70">{node.sku} · {data?.locations.find(location => location.id === node.locationId)?.name}</span></>}
        onClick={() => { onOpen(); onNavigate({ scmNode: node.key }); setQuery(''); }} />)}
      {!matches.length && <p className="px-2.5 py-2 text-[11px] text-muted-foreground/60">{t('No matching items.')}</p>}
    </div>}

    <div className="flex flex-col">{PRIMARY.map(navRow)}</div>
    <div className="my-2 h-px bg-[var(--border-subtle)]" />
    <div className="flex flex-col">{SECONDARY.map(navRow)}</div>

    {scopes.length > 0 && <>
      <SidebarSectionLabel>{t('Domains')}</SidebarSectionLabel>
      <div className="flex flex-col">
        {scopes.map(entry => <SidebarRow key={entry.id ?? 'all'} active={scope === entry.id} buttonProps={{ 'aria-pressed': scope === entry.id, 'aria-current': undefined }}
          icon={<Layers size={16} />} label={entry.name}
          onClick={() => { onOpen(); onNavigate({ scmScope: entry.id, scmLocationId: null, scmNode: null }); }} />)}
      </div>
    </>}

    {data && data.locations.length > 1 && <>
      <SidebarSectionLabel>{t('Locations')}</SidebarSectionLabel>
      <div className="flex flex-col">
        {[{ id: null as string | null, name: t('All locations') }, ...data.locations].map(location => {
          const risk = location.id ? riskByLocation.get(location.id) ?? 0 : [...riskByLocation.values()].reduce((sum, value) => sum + value, 0);
          return <SidebarRow key={location.id ?? 'all'} active={locationId === location.id} buttonProps={{ 'aria-pressed': locationId === location.id, 'aria-current': undefined }}
            icon={<MapPin size={16} />} label={location.name}
            meta={risk > 0 ? <span className="text-[var(--status-danger)]" title={t('{n} at risk', { n: risk })}>{risk}</span> : null}
            onClick={() => { onOpen(); onNavigate({ scmLocationId: location.id, scmNode: null }); }} />;
        })}
      </div>
    </>}

    {data && data.items.length > 0 && <SidebarRow size="tall" className="mt-3" icon={<Bot size={16} />}
      label={<><span className="block truncate">{t('Autopilot')}</span><span className="block truncate text-[11px] font-normal text-muted-foreground/70">{data.policy.autopilotEnabled ? t('On · approves up to {n}', { n: data.policy.autoApproveLimit.toLocaleString() }) : t('Off · proposals only')}</span></>}
      meta={<Dot tone={data.policy.autopilotEnabled ? 'success' : 'muted'} />}
      onClick={() => go('settings')} />}
  </div>;
}
