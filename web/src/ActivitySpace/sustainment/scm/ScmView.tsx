'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Check, Layers, MapPin, MoreHorizontal, Plus, RefreshCw, Settings2, Warehouse, Bot } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell } from '@/Function/shared/menu';
import { PageHead } from '@/Function/shared/PageHead';
import { RailCard } from '@/Function/shared/RailCard';
import { RailRow } from '@/Function/shared/RailRow';
import { ToolPage, type ToolView } from '@/Function/shared/tool/ToolPage';
import { PlacePage } from '@/Function/shared/tool/PlacePage';
import { RecordPage } from '@/Function/shared/tool/RecordPage';
import { ScmIcon } from '@/Function/shared/conceptIcons';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { askCopilot } from '@/Function/copilot/copilotBridge';
import { useScmActions, useScmData, useScmPlan } from '@/hooks/useScm';
import { useSustainmentDomains } from '@/hooks/useSustainmentDomains';
import type { ScmProposal } from './scmEngine';
import { scmScopes, scopeDomain, scopeScmData, supplyDomainIds, SPACE_SCOPE } from './scmScope';
import type { NavigationState } from '@/types/navigation';
import { explainProposal } from './scmText';
import { LOCATION_VIEWS, ROOT_VIEWS, SCM_VIEW_DESCRIPTION, SCM_VIEW_ICON, SCM_VIEW_LABEL, scmViewCounts, scmViewOf, type ScmView as ScmPane } from './scmNavigation';
import { Pill, ScmViewBadge } from './ScmParts';
import { ScmSurfaceContext, type ScmDialog, type ScmSurface } from './scmSurface';
import { ItemDialog, MovementDialog, NewOrderDialog, OrderBody, SupplierDialog } from './ScmForms';
import { ScmTower } from './ScmTower';
import { ScmExceptions, ScmInventory, ScmOrders, ScmSuppliers } from './ScmLists';
import { ScmReplenish } from './ScmReplenish';
import { ScmItemPage } from './ScmItemDetail';
import { ScmSupplierPage } from './ScmSupplierPage';
import { formatDay, formatMoney, PO_STATUS_LABEL } from './scmText';
import { ScmScenarios } from './ScmScenarios';
import { ScmLedger } from './ScmLedger';
import { ScmDataSection, ScmImport, ScmLocations, ScmOnboarding, ScmPolicyForm } from './ScmSettings';

/** Autopilot runs at most once a day, the first time SCM is opened. */
const AUTOPILOT_INTERVAL_MS = 20 * 60 * 60 * 1000;

export function ScmView({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (navigation: Partial<NavigationState>) => void }) {
  const { t, locale } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: everything, loading, error, refetch } = useScmData(spaceId);
  const { data: spaceDomains } = useSustainmentDomains();
  const domains = useMemo(() => spaceDomains.map(domain => ({ id: domain.id, name: domain.name })).sort((a, b) => a.name.localeCompare(b.name)), [spaceDomains]);
  // The panes show one scope; the autopilot always acts on everything the viewer can see.
  const scope = navigation.scmScope ?? null;
  const data = useMemo(() => everything ? scopeScmData(everything, scope) : null, [everything, scope]);
  const plan = useScmPlan(data);
  const fullPlan = useScmPlan(everything);
  const actions = useScmActions(spaceId);
  const view = scmViewOf(navigation);
  const locationId = navigation.scmLocationId && data?.locations.some(location => location.id === navigation.scmLocationId) ? navigation.scmLocationId : null;
  const [dialog, setDialog] = useState<ScmDialog | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const nodes = useMemo(() => plan?.nodes.filter(node => !locationId || node.locationId === locationId) ?? [], [plan, locationId]);
  // Going to a pane leaves any record page and its filters behind. A pane of
  // the whole supply (Suppliers, Orders, the tower's own) also leaves the
  // location; a location's pane keeps it.
  const go = useCallback((next: ScmPane, extra: Partial<NavigationState> = {}) => {
    const leavesLocation = next === 'suppliers' || next === 'tower' || next === 'settings' || next === 'exceptions' || next === 'replenish' || next === 'scenarios';
    onNavigate({ scmView: next, scmNode: null, scmOrderId: null, scmSupplierId: null, scmHealth: null, scmSupplierDelay: null, scmLedgerItemId: null, scmCatalog: null, ...(leavesLocation ? { scmLocationId: null } : {}), ...extra });
  }, [onNavigate]);
  /** The proposals of each scope the autopilot claims separately: the
   * Space-wide locations, and each Domain's. */
  const proposalsByScope = useCallback((proposals: ScmProposal[]) => {
    const domainOf = new Map(everything?.locations.map(location => [location.id, location.domainId ?? null]) ?? []);
    const groups = new Map<string | null, ScmProposal[]>();
    for (const proposal of proposals) {
      const domain = domainOf.get(proposal.locationId) ?? null;
      groups.set(domain, [...groups.get(domain) ?? [], proposal]);
    }
    return groups;
  }, [everything]);

  /** daily: the automatic pass on opening SCM, for every scope whose run is
   * due. manual: the button, for the panes' scope and location; with the
   * autopilot off it drafts everything for approval. */
  const runPlanner = useCallback(async (trigger: 'daily' | 'manual', scopes?: (string | null)[]) => {
    if (!everything || !fullPlan) return;
    const mode = everything.policy.autopilotEnabled ? 'autopilot' as const : 'draft' as const;
    const shown = scopeDomain(scope);
    const proposals = trigger === 'daily' ? fullPlan.proposals
      : fullPlan.proposals.filter(proposal => (!locationId || proposal.locationId === locationId)
        && (shown === undefined || (everything.locations.find(location => location.id === proposal.locationId)?.domainId ?? null) === shown));
    setRunning(true); setRunError(null);
    try {
      let skipped = false;
      for (const [domainId, group] of proposalsByScope(proposals)) {
        if (scopes && !scopes.includes(domainId)) continue;
        const result = await actions.placeProposals(group, {
          mode, policy: everything.policy, today: everything.today, domainId,
          minHoursSinceLastRun: trigger === 'daily' ? AUTOPILOT_INTERVAL_MS / 3_600_000 : undefined,
          explain: proposal => explainProposal(proposal, fullPlan, t, locale, mode),
        });
        if (result === null) skipped = true;
      }
      if (skipped && trigger === 'manual') setRunError(t('The planner ran moments ago in another window. Refresh to see its orders.'));
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally { setRunning(false); }
  }, [actions, everything, fullPlan, proposalsByScope, scope, t, locale, locationId]);

  // The daily autopilot pass, per scope. Guarded per Space and per session so
  // two renders or two panes never run it twice.
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    if (!everything || !fullPlan || !everything.policy.autopilotEnabled || running || autoRan.current === everything.spaceId) return;
    const pending = proposalsByScope(fullPlan.proposals);
    const due = scmScopes(everything.locations).filter(domainId => {
      const last = everything.runs.find(run => run.domainId === domainId);
      return pending.has(domainId) && Date.now() - (last ? Date.parse(last.ranAt) : 0) >= AUTOPILOT_INTERVAL_MS;
    });
    if (!due.length) return;
    // Marked when the run actually starts, so a cancelled timer (StrictMode,
    // a dependency change) does not swallow the day's run.
    const spaceId = everything.spaceId;
    const timer = setTimeout(() => { autoRan.current = spaceId; void runPlanner('daily', due); }, 0);
    return () => clearTimeout(timer);
  }, [everything, fullPlan, running, runPlanner, proposalsByScope]);

  const domainName = useCallback((id: string | null | undefined) => id ? domains.find(domain => domain.id === id)?.name ?? t('Unknown Domain') : null, [domains, t]);
  const scopeLabel = scope === null ? null : scope === SPACE_SCOPE ? t('Shared by the Space') : domainName(scope);

  const surface = useMemo<ScmSurface | null>(() => data && plan ? {
    data, plan, actions, locationId, nodes, go,
    scope, scopeDomainId: scopeDomain(scope) ?? null, domains, domainName,
    openNode: key => onNavigate({ scmNode: key, scmOrderId: null, scmSupplierId: null }),
    openOrder: id => onNavigate({ scmOrderId: id, scmNode: null, scmSupplierId: null }),
    openSupplier: id => onNavigate({ scmSupplierId: id, scmNode: null, scmOrderId: null }),
    openDialog: setDialog,
    askCopilot: text => askCopilot({ text, viewLabel: `SCM › ${t(SCM_VIEW_LABEL[view])}`, spaceId: data.spaceId }),
    locationName: id => data.locations.find(location => location.id === id)?.name ?? '—',
    supplierName: id => (id && data.suppliers.find(supplier => supplier.id === id)?.name) || t('No supplier'),
  } : null, [data, plan, actions, locationId, nodes, go, onNavigate, t, view, scope, domains, domainName]);

  if (!spaceId) return <Frame><p className="py-12 text-center text-sm text-muted-foreground">{t('Choose or create a Space to use SCM. Supply chain data belongs to a Space and is shared with its members.')}</p></Frame>;
  if (loading) return <Frame><div className="space-y-4 py-6">{[0, 1, 2].map(index => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted/50" />)}</div></Frame>;
  if (error || !data || !plan || !surface) return <Frame><div role="alert" className="space-y-3 py-12 text-center"><p className="text-sm text-destructive">{t('Could not load SCM.')} {error?.message}</p><Button onClick={() => void refetch()}>{t('Retry')}</Button></div></Frame>;

  const empty = !data.items.length;
  const node = navigation.scmNode ? plan.nodes.find(entry => entry.key === navigation.scmNode) ?? null : null;
  const order = navigation.scmOrderId ? data.orders.find(entry => entry.id === navigation.scmOrderId) ?? null : null;
  const location = locationId ? data.locations.find(entry => entry.id === locationId) ?? null : null;
  const counts = scmViewCounts(data, plan, nodes, locationId);
  const muted = 'size-3.5 text-muted-foreground';
  const tabsFor = (ids: readonly ScmPane[]) => ids.map((id): ToolView => ({
    id, label: id === 'tower' || id === 'location' ? 'Overview' : SCM_VIEW_LABEL[id], icon: SCM_VIEW_ICON[id],
    description: SCM_VIEW_DESCRIPTION[id], badge: <ScmViewBadge view={id} counts={counts} />,
  }));
  const settingsDialog = view === 'settings' && <Dialog open onOpenChange={open => { if (!open) go('tower', { scmLocationId: locationId }); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
      <DialogTitle>{t('Planning settings')}</DialogTitle>
      <DialogDescription>{t('Planning settings for the policy, locations and data.')}</DialogDescription>
      <div className="space-y-10">
        <ScmPolicyForm key={`${data.spaceId}:${data.hasPolicy}`} data={data} actions={actions} />
        <ScmLocations key={scope ?? 'all'} data={data} actions={actions} />
        <ScmImport data={data} actions={actions} />
        <ScmDataSection data={data} actions={actions} />
      </div>
    </DialogContent>
  </Dialog>;
  const dialogs = <>
    {settingsDialog}
    {dialog?.kind === 'item' && <ItemDialog data={data} actions={actions} item={dialog.item} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'supplier' && <SupplierDialog data={data} actions={actions} supplierId={dialog.supplierId} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'movement' && <MovementDialog data={data} actions={actions} initial={dialog.initial} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'new-order' && <NewOrderDialog data={data} actions={actions} initial={dialog.initial} onClose={() => setDialog(null)} />}
  </>;
  const moreMenu = <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('More')}><MoreHorizontal size={14} /></Button></DropdownMenuTrigger>
    <MenuShell as="dropdown" align="end">
      <DropdownMenuItem className="gap-2" onSelect={() => void refetch()}><RefreshCw size={12} />{t('Refresh')}</DropdownMenuItem>
      <DropdownMenuItem className="gap-2" onSelect={() => onNavigate({ scmView: 'settings' })}><Settings2 size={12} />{t('Planning settings')}</DropdownMenuItem>
    </MenuShell>
  </DropdownMenu>;

  // ── A record's page ─────────────────────────────────────────────────
  if (node || navigation.scmNode) return <ScmSurfaceContext.Provider value={surface}>
    {node ? <ScmItemPage key={node.key} node={node} onBack={() => onNavigate({ scmNode: null })}
      onOpenLocation={() => onNavigate({ scmNode: null, scmLocationId: node.locationId, scmView: 'location' })} />
      : <PlacePage icon={ScmIcon} title={t('Inventory')}><div className="space-y-3 py-12 text-center"><p className="text-sm text-muted-foreground">{t('This item is no longer planned here.')}</p><Button onClick={() => onNavigate({ scmNode: null })}>{t('Back')}</Button></div></PlacePage>}
    {dialogs}
  </ScmSurfaceContext.Provider>;
  if (order) {
    const openStatus = ['approved', 'sent', 'partial'].includes(order.status);
    const overdue = openStatus && order.expectedOn < data.today;
    const total = order.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
    return <ScmSurfaceContext.Provider value={surface}>
      <RecordPage icon={ScmIcon} crumbs={[{ label: t('Purchase orders'), onClick: () => go('orders') }, { label: `PO-${order.number}` }]} onBack={() => onNavigate({ scmOrderId: null })}
        rail={<RailCard title={t('Properties')}>
          <RailRow name={t('Status')} dense label={<Pill tone={order.status === 'draft' ? 'warning' : order.status === 'cancelled' ? 'muted' : order.status === 'received' ? 'success' : overdue ? 'danger' : 'info'}>{overdue ? t('Overdue') : t(PO_STATUS_LABEL[order.status])}</Pill>} />
          <button type="button" className="w-full" onClick={() => surface.openSupplier(order.supplierId)}><RailRow name={t('Supplier')} dense label={surface.supplierName(order.supplierId)} /></button>
          <button type="button" className="w-full" onClick={() => onNavigate({ scmOrderId: null, scmLocationId: order.locationId, scmView: 'location' })}><RailRow name={t('Deliver to')} dense label={surface.locationName(order.locationId)} /></button>
          <RailRow name={t('Ordered')} dense label={formatDay(order.orderedOn, locale)} />
          <RailRow name={order.status === 'received' ? t('Received') : t('Expected')} dense label={<span className={overdue ? 'text-[var(--status-danger)]' : undefined}>{formatDay(order.status === 'received' && order.receivedOn ? order.receivedOn : order.expectedOn, locale)}</span>} />
          <RailRow name={t('Lines')} dense label={String(order.lines.length)} />
          <RailRow name={t('Value')} dense label={formatMoney(total, order.currency, locale)} />
          <RailRow name={t('Source')} dense label={order.source === 'human' ? t('Person') : order.source === 'copilot' ? 'Copilot' : t('Autopilot')} />
        </RailCard>}>
        <PageHead icon={<ScmIcon size={18} />} title={`PO-${order.number} · ${surface.supplierName(order.supplierId)}`} description={t('To {location}', { location: surface.locationName(order.locationId) })}
          canEdit={false} titleLabel={t('Order')} titlePlaceholder="" descriptionLabel="" descriptionPlaceholder="" onSaveTitle={() => {}} />
        <OrderBody key={order.id} data={data} actions={actions} orderId={order.id} onClose={() => onNavigate({ scmOrderId: null })} onOpenNode={key => onNavigate({ scmOrderId: null, scmNode: key })} />
      </RecordPage>
      {dialogs}
    </ScmSurfaceContext.Provider>;
  }
  if (navigation.scmSupplierId) return <ScmSurfaceContext.Provider value={surface}>
    <ScmSupplierPage key={navigation.scmSupplierId} supplierId={navigation.scmSupplierId} onBack={() => onNavigate({ scmSupplierId: null })} onOpenSuppliers={() => go('suppliers')} />
    {dialogs}
  </ScmSurfaceContext.Provider>;

  // ── The places beside the locations ─────────────────────────────────
  if (view === 'suppliers') return <ScmSurfaceContext.Provider value={surface}>
    <PlacePage icon={ScmIcon} title={t('Suppliers')} actions={<Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'supplier', supplierId: null })}><Plus size={14} />{t('Add supplier')}</Button>}>
      <ScmSuppliers />
    </PlacePage>
    {dialogs}
  </ScmSurfaceContext.Provider>;
  if (view === 'orders' && !location) return <ScmSurfaceContext.Provider value={surface}>
    <PlacePage icon={ScmIcon} title={t('Purchase orders')}><ScmOrders /></PlacePage>
    {dialogs}
  </ScmSurfaceContext.Provider>;

  // ── A location ──────────────────────────────────────────────────────
  if (location) {
    const tab = (LOCATION_VIEWS as readonly string[]).includes(view) ? view : 'location';
    const risk = nodes.filter(entry => entry.health === 'stockout' || entry.health === 'critical').length;
    const openOrders = data.orders.filter(entry => entry.locationId === location.id && ['approved', 'sent', 'partial'].includes(entry.status)).length;
    return <ScmSurfaceContext.Provider value={surface}>
      <ToolPage icon={ScmIcon} tool="SCM" crumb={location.name} storageKey="scm-location" home="location"
        views={tabsFor(LOCATION_VIEWS)} activeView={tab} onSelectView={id => onNavigate({ scmView: id as ScmPane, scmNode: null, scmOrderId: null, scmHealth: null, scmLedgerItemId: null, scmCatalog: null })}
        actions={moreMenu}
        head={<PageHead icon={<ScmIcon size={18} />} title={location.name} description={t(SCM_VIEW_DESCRIPTION.location)} canEdit={false}
          titleLabel={t('Location')} titlePlaceholder="" descriptionLabel="" descriptionPlaceholder="" onSaveTitle={() => {}} />}
        properties={<RailCard title={t('Properties')}>
          {location.code && <RailRow icon={<MapPin className={muted} />} name={t('Code')} dense label={location.code} />}
          <RailRow icon={<Layers className={muted} />} name={t('Domain')} dense label={domainName(location.domainId) ?? t('Shared by the Space')} placeholder={!location.domainId} />
          <button type="button" className="w-full" onClick={() => onNavigate({ scmView: 'inventory' })}><RailRow icon={<Boxes className={muted} />} name={t('Items here')} dense label={String(nodes.length)} placeholder={!nodes.length} /></button>
          <button type="button" className="w-full" onClick={() => onNavigate({ scmView: 'inventory', scmHealth: 'critical' })}><RailRow name={t('At risk')} dense label={<span className={risk ? 'text-[var(--status-danger)]' : undefined}>{risk}</span>} placeholder={!risk} /></button>
          <button type="button" className="w-full" onClick={() => onNavigate({ scmView: 'orders' })}><RailRow name={t('Open orders')} dense label={String(openOrders)} placeholder={!openOrders} /></button>
        </RailCard>}
        scrollKey={locationId}>
        <div className="space-y-6">
          {runError && <p role="alert" className="text-sm text-destructive">{runError}</p>}
          {tab === 'location' && <ScmTower running={running} onRunPlanner={() => void runPlanner('manual')} />}
          {tab === 'inventory' && <ScmInventory health={navigation.scmHealth ?? null} onHealth={health => onNavigate({ scmHealth: health })} catalog={!!navigation.scmCatalog} onCatalog={catalog => onNavigate({ scmCatalog: catalog })} />}
          {tab === 'orders' && <ScmOrders />}
          {tab === 'ledger' && <ScmLedger itemId={navigation.scmLedgerItemId ?? null} onItem={itemId => onNavigate({ scmLedgerItemId: itemId })} />}
        </div>
      </ToolPage>
      {dialogs}
    </ScmSurfaceContext.Provider>;
  }

  // ── The whole supply: the control tower ─────────────────────────────
  const tab = (ROOT_VIEWS as readonly string[]).includes(view) ? view : 'tower';
  const scopeOptions = (() => {
    const used = supplyDomainIds(everything ?? data, scope);
    if (!used.length) return [];
    const named = used.map(id => ({ id: id as string | null, name: domainName(id) ?? t('Unknown Domain') })).sort((a, b) => a.name.localeCompare(b.name));
    return [{ id: null as string | null, name: t('Everything') }, { id: SPACE_SCOPE as string | null, name: t('Shared by the Space') }, ...named];
  })();
  const properties = !empty && <RailCard title={t('Properties')}>
    {scopeOptions.length > 0 && <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="w-full" aria-label={t('Whose supply')}><RailRow icon={<Layers className={muted} />} name={t('Whose supply')} label={scopeLabel ?? t('Everything')} placeholder={scope === null} dense /></button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        {scopeOptions.map(option => <DropdownMenuItem key={option.id ?? 'all'} className="gap-2" onSelect={() => onNavigate({ scmScope: option.id, scmLocationId: null, scmNode: null })}>
          <span className="min-w-0 flex-1 truncate">{option.name}</span>{option.id === scope && <Check size={12} />}
        </DropdownMenuItem>)}
      </MenuShell>
    </DropdownMenu>}
    <button type="button" className="w-full" onClick={() => onNavigate({ scmView: 'settings' })}>
      <RailRow icon={<Bot className={muted} />} name={t('Autopilot')} dense
        label={data.policy.autopilotEnabled ? t('On · approves up to {n}', { n: data.policy.autoApproveLimit.toLocaleString() }) : t('Off · proposals only')}
        placeholder={!data.policy.autopilotEnabled} />
    </button>
    <button type="button" className="w-full" onClick={() => onNavigate({ scmView: 'settings' })}>
      <RailRow icon={<Settings2 className={muted} />} name={t('Service level')} dense label={`${Math.round(data.policy.serviceLevel * 1000) / 10}%`} />
    </button>
    <div className="mx-2 my-2 h-px bg-[var(--border-subtle)]" />
    <RailRow icon={<MapPin className={muted} />} name={t('Locations')} dense label={String(data.locations.length)} placeholder={!data.locations.length} />
    <button type="button" className="w-full" onClick={() => go('inventory')}><RailRow icon={<Boxes className={muted} />} name={t('Items')} dense label={String(data.items.length)} placeholder={!data.items.length} /></button>
    <button type="button" className="w-full" onClick={() => go('suppliers')}><RailRow icon={<Warehouse className={muted} />} name={t('Suppliers')} dense label={String(data.suppliers.length)} placeholder={!data.suppliers.length} /></button>
  </RailCard>;

  return <ScmSurfaceContext.Provider value={surface}>
    <ToolPage icon={ScmIcon} tool="SCM" crumb={scopeLabel ?? undefined} storageKey="scm-tower" home="tower"
      views={tabsFor(ROOT_VIEWS)} activeView={tab} onSelectView={id => go(id as ScmPane)}
      actions={!empty && moreMenu}
      head={<PageHead icon={<ScmIcon size={18} />} title={scopeLabel ?? t('Supply chain')} description={t(SCM_VIEW_DESCRIPTION.tower)}
        canEdit={false} titleLabel={t('Supply chain')} titlePlaceholder="" descriptionLabel={t('Description')} descriptionPlaceholder="" onSaveTitle={() => {}} />}
      properties={properties}>
      <div className="space-y-6">
        {runError && <p role="alert" className="text-sm text-destructive">{runError}</p>}
        {empty ? <ScmOnboarding data={data} actions={actions} onAddItem={() => setDialog({ kind: 'item', item: null })} />
          : <>
            {tab === 'tower' && <ScmTower running={running} onRunPlanner={() => void runPlanner('manual')} />}
            {tab === 'exceptions' && <ScmExceptions />}
            {tab === 'replenish' && <ScmReplenish running={running} onRunPlanner={() => void runPlanner('manual')} />}
            {tab === 'inventory' && <ScmInventory health={navigation.scmHealth ?? null} onHealth={health => onNavigate({ scmHealth: health })} catalog={!!navigation.scmCatalog} onCatalog={catalog => onNavigate({ scmCatalog: catalog })} />}
            {tab === 'ledger' && <ScmLedger itemId={navigation.scmLedgerItemId ?? null} onItem={itemId => onNavigate({ scmLedgerItemId: itemId })} />}
            {tab === 'scenarios' && <ScmScenarios key={navigation.scmSupplierDelay ?? 'none'} supplierDelay={navigation.scmSupplierDelay ?? null} />}
          </>}
      </div>
    </ToolPage>
    {dialogs}
  </ScmSurfaceContext.Provider>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1 overflow-y-auto bg-card"><div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</div></div>;
}
