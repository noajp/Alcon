'use client';

import { useMemo, useState } from 'react';
import { Bot, Check, ChevronDown, LayoutDashboard, Layers, MapPin, Search, Truck, Warehouse, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useScmData, useScmPlan } from '@/hooks/useScm';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import { scopeScmData, supplyDomainIds, SPACE_SCOPE } from './scmScope';
import type { NavigationState } from '@/types/navigation';
import { ROOT_VIEWS, scmViewOf } from './scmNavigation';
import type { ScmNode } from './scmEngine';
import { HEALTH_TONE } from './scmText';
import { Dot } from './ScmParts';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';

// The SCM sidebar is the App's tree, the way Execution's is Domains: whose
// supply is shown (the Space's, or a Domain's), then the places you can be
// in — the control tower for the whole supply, each location, and the
// records shared across locations (suppliers, orders). What narrows a pane
// (a stock health) is a filter inside it, not a place here.

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
  const scopes = useMemo(() => {
    if (!everything) return [];
    const used = supplyDomainIds(everything, scope);
    if (!used.length) return [];
    const named = used.map(id => ({ id: id as string | null, name: spaceDomains.find(domain => domain.id === id)?.name ?? t('Unknown Domain') })).sort((a, b) => a.name.localeCompare(b.name));
    return [{ id: null as string | null, name: t('Everything') }, { id: SPACE_SCOPE as string | null, name: t('Shared by the Space') }, ...named];
  }, [everything, spaceDomains, scope, t]);
  const [query, setQuery] = useState('');
  const view = scmViewOf(navigation);
  const locationId = navigation.scmLocationId && data?.locations.some(location => location.id === navigation.scmLocationId) ? navigation.scmLocationId : null;
  const onRecord = !!(navigation.scmNode || navigation.scmOrderId || navigation.scmSupplierId);
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
  const clear = { scmNode: null, scmOrderId: null, scmSupplierId: null, scmHealth: null, scmSupplierDelay: null, scmLedgerItemId: null, scmCatalog: null } as const;
  const openOrders = data ? data.orders.filter(order => ['draft', 'approved', 'sent', 'partial'].includes(order.status)).length : 0;
  const currentScope = scopes.find(entry => entry.id === scope);

  return <div className="mt-1 flex flex-col pb-4">
    <SidebarSectionLabel>SCM</SidebarSectionLabel>
    {scopes.length > 0 && <div className="mt-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="w-full" aria-label={t('Whose supply')}>
            <SidebarRow icon={<Layers size={16} />} label={currentScope?.name ?? t('Everything')} meta={<ChevronDown size={12} />} />
          </button>
        </DropdownMenuTrigger>
        <MenuShell as="dropdown" align="start">
          {scopes.map(entry => <DropdownMenuItem key={entry.id ?? 'all'} className="gap-2" onSelect={() => { onOpen(); onNavigate({ scmScope: entry.id, scmLocationId: null, scmView: 'tower', ...clear }); }}>
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>{entry.id === scope && <Check size={12} />}
          </DropdownMenuItem>)}
        </MenuShell>
      </DropdownMenu>
    </div>}
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

    <div className="mt-1 flex flex-col">
      <SidebarRow active={!locationId && !onRecord && ROOT_VIEWS.includes(view)} icon={<LayoutDashboard size={16} />} label={t('Control tower')}
        onClick={() => { onOpen(); onNavigate({ scmLocationId: null, scmView: 'tower', ...clear }); }} />
    </div>

    {data && data.locations.length > 0 && <>
      <SidebarSectionLabel>{t('Locations')}</SidebarSectionLabel>
      <div className="flex flex-col">
        {data.locations.map(location => {
          const risk = riskByLocation.get(location.id) ?? 0;
          return <SidebarRow key={location.id} active={locationId === location.id && !onRecord} icon={<MapPin size={16} />} label={location.name}
            meta={risk > 0 ? <span className="text-[var(--status-danger)]" title={t('{n} at risk', { n: risk })}>{risk}</span> : null}
            onClick={() => { onOpen(); onNavigate({ scmLocationId: location.id, scmView: 'location', ...clear }); }} />;
        })}
      </div>
    </>}

    {data && data.items.length > 0 && <>
      <SidebarSectionLabel>{t('Records')}</SidebarSectionLabel>
      <div className="flex flex-col">
        <SidebarRow active={view === 'suppliers' && !onRecord} icon={<Warehouse size={16} />} label={t('Suppliers')} meta={data.suppliers.length || null}
          onClick={() => { onOpen(); onNavigate({ scmLocationId: null, scmView: 'suppliers', ...clear }); }} />
        <SidebarRow active={view === 'orders' && !locationId && !onRecord} icon={<Truck size={16} />} label={t('Purchase orders')} meta={openOrders || null}
          onClick={() => { onOpen(); onNavigate({ scmLocationId: null, scmView: 'orders', ...clear }); }} />
      </div>
    </>}

    {data && data.items.length > 0 && <SidebarRow size="tall" className="mt-3" icon={<Bot size={16} />}
      label={<><span className="block truncate">{t('Autopilot')}</span><span className="block truncate text-[11px] font-normal text-muted-foreground/70">{data.policy.autopilotEnabled ? t('On · approves up to {n}', { n: data.policy.autoApproveLimit.toLocaleString() }) : t('Off · proposals only')}</span></>}
      meta={<Dot tone={data.policy.autopilotEnabled ? 'success' : 'muted'} />}
      onClick={() => { onOpen(); onNavigate({ scmView: 'settings', ...clear }); }} />}
  </div>;
}
