'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, MapPin, MoreHorizontal, RefreshCw, Settings2, Warehouse, Bot } from 'lucide-react';
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
import { scmScopes, scopeDomain, scopeScmData } from './scmScope';
import { useScmScope } from './scmScopeState';
import type { NavigationState } from '@/types/navigation';
import { explainProposal } from './scmText';
import { ROOT_VIEWS, SCM_VIEW_DESCRIPTION, SCM_VIEW_ICON, SCM_VIEW_LABEL, scmViewCounts, scmViewOf, type ScmView as ScmPane } from './scmNavigation';
import { Pill, ScmViewBadge } from './ScmParts';
import { ScmSurfaceContext, type ScmDialog, type ScmSurface } from './scmSurface';
import { ItemDialog, MovementDialog, NewOrderDialog, OrderBody, SupplierDialog } from './ScmForms';
import { ScmTower } from './ScmTower';
import { ScmExceptions, ScmInventory, ScmLocationList, ScmOrders, ScmSuppliers } from './ScmLists';
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
  // The panes show the sidebar's scope; the autopilot always acts on everything the viewer can see.
  const { scope, scopeName } = useScmScope(everything);
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
  // Going to a pane leaves any record page and its filters behind — the
  // location among them: it narrows Items and Orders, opened from Locations.
  const go = useCallback((next: ScmPane, extra: Partial<NavigationState> = {}) => {
    onNavigate({ scmView: next, scmNode: null, scmOrderId: null, scmSupplierId: null, scmHealth: null, scmSupplierDelay: null, scmLedgerItemId: null, scmCatalog: null, scmOrderFilter: null, scmLocationId: null, ...extra });
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
  // `item:` (from ⌘K) opens the item where it is held — its first location.
  const nodeKey = navigation.scmNode;
  const node = nodeKey ? plan.nodes.find(entry => entry.key === nodeKey || (nodeKey.endsWith(':') && entry.key.startsWith(nodeKey))) ?? null : null;
  const order = navigation.scmOrderId ? data.orders.find(entry => entry.id === navigation.scmOrderId) ?? null : null;
  const location = locationId ? data.locations.find(entry => entry.id === locationId) ?? null : null;
  const counts = scmViewCounts(data, plan, plan.nodes, null);
  const muted = 'size-3.5 text-muted-foreground';
  const settingsDialog = view === 'settings' && <Dialog open onOpenChange={open => { if (!open) go('tower'); }}>
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
    {node ? <ScmItemPage key={node.key} node={node} onBack={() => onNavigate({ scmNode: null })} onOpenItems={() => go('inventory')}
      onOpenLocation={() => go('inventory', { scmLocationId: node.locationId })} />
      : <PlacePage icon={ScmIcon} title={t('Items')}><div className="space-y-3 py-12 text-center"><p className="text-sm text-muted-foreground">{t('This item is no longer planned here.')}</p><Button onClick={() => onNavigate({ scmNode: null })}>{t('Back')}</Button></div></PlacePage>}
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
          <button type="button" className="w-full" onClick={() => go('inventory', { scmLocationId: order.locationId })}><RailRow name={t('Deliver to')} dense label={surface.locationName(order.locationId)} /></button>
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

  // ── The places in the sidebar ───────────────────────────────────────
  // A location narrows Items and Orders; its chip in the header lifts it.
  const locationChip = location && <Button size="sm" variant="secondary" onClick={() => onNavigate({ scmLocationId: null })}><MapPin size={14} />{location.name} ✕</Button>;
  const place = (title: string, content: React.ReactNode, actions?: React.ReactNode) => <ScmSurfaceContext.Provider value={surface}>
    <PlacePage icon={ScmIcon} title={title} actions={actions}>
      {runError && <p role="alert" className="mb-4 text-sm text-destructive">{runError}</p>}
      {content}
    </PlacePage>
    {dialogs}
  </ScmSurfaceContext.Provider>;
  if (!empty && view === 'exceptions') return place(t('Needs attention'), <ScmExceptions />);
  if (!empty && view === 'orders') return place(t('Purchase orders'),
    <ScmOrders filter={navigation.scmOrderFilter ?? 'open'} onFilter={filter => onNavigate({ scmOrderFilter: filter })} />, locationChip);
  if (!empty && view === 'inventory') return place(t('Items'),
    <ScmInventory health={navigation.scmHealth ?? null} onHealth={health => onNavigate({ scmHealth: health })} catalog={!!navigation.scmCatalog} onCatalog={catalog => onNavigate({ scmCatalog: catalog })} />, locationChip);
  if (!empty && view === 'suppliers') return place(t('Suppliers'), <ScmSuppliers />);
  if (!empty && view === 'locations') return place(t('Locations'), <ScmLocationList onOpen={id => go('inventory', { scmLocationId: id })} />,
    <Button size="sm" variant="ghost" onClick={() => onNavigate({ scmView: 'settings' })}><Settings2 size={14} />{t('Manage locations')}</Button>);

  // ── The scope's overview: the control tower ─────────────────────────
  const tab = (ROOT_VIEWS as readonly string[]).includes(view) ? view : 'tower';
  const tabs = ROOT_VIEWS.map((id): ToolView => ({
    id, label: id === 'tower' ? 'Overview' : SCM_VIEW_LABEL[id], icon: SCM_VIEW_ICON[id],
    description: SCM_VIEW_DESCRIPTION[id], badge: <ScmViewBadge view={id} counts={counts} />,
  }));
  const properties = !empty && <RailCard title={t('Properties')}>
    <button type="button" className="w-full" onClick={() => onNavigate({ scmView: 'settings' })}>
      <RailRow icon={<Bot className={muted} />} name={t('Autopilot')} dense
        label={data.policy.autopilotEnabled ? t('On · approves up to {n}', { n: data.policy.autoApproveLimit.toLocaleString() }) : t('Off · proposals only')}
        placeholder={!data.policy.autopilotEnabled} />
    </button>
    <button type="button" className="w-full" onClick={() => onNavigate({ scmView: 'settings' })}>
      <RailRow icon={<Settings2 className={muted} />} name={t('Service level')} dense label={`${Math.round(data.policy.serviceLevel * 1000) / 10}%`} />
    </button>
    <div className="mx-2 my-2 h-px bg-[var(--border-subtle)]" />
    <button type="button" className="w-full" onClick={() => go('locations')}><RailRow icon={<MapPin className={muted} />} name={t('Locations')} dense label={String(data.locations.length)} placeholder={!data.locations.length} /></button>
    <button type="button" className="w-full" onClick={() => go('inventory')}><RailRow icon={<Boxes className={muted} />} name={t('Items')} dense label={String(data.items.length)} placeholder={!data.items.length} /></button>
    <button type="button" className="w-full" onClick={() => go('suppliers')}><RailRow icon={<Warehouse className={muted} />} name={t('Suppliers')} dense label={String(data.suppliers.length)} placeholder={!data.suppliers.length} /></button>
  </RailCard>;

  return <ScmSurfaceContext.Provider value={surface}>
    <ToolPage icon={ScmIcon} tool="SCM" crumb={scope === null ? undefined : scopeName} storageKey="scm-tower" home="tower"
      views={tabs} activeView={tab} onSelectView={id => go(id as ScmPane)}
      actions={!empty && moreMenu}
      head={<PageHead icon={<ScmIcon size={18} />} title={scope === null ? t('Supply chain') : scopeName} description={t(SCM_VIEW_DESCRIPTION.tower)}
        canEdit={false} titleLabel={t('Supply chain')} titlePlaceholder="" descriptionLabel={t('Description')} descriptionPlaceholder="" onSaveTitle={() => {}} />}
      properties={properties}>
      <div className="space-y-6">
        {runError && <p role="alert" className="text-sm text-destructive">{runError}</p>}
        {empty ? <ScmOnboarding data={data} actions={actions} onAddItem={() => setDialog({ kind: 'item', item: null })} />
          : <>
            {tab === 'tower' && <ScmTower running={running} onRunPlanner={() => void runPlanner('manual')} />}
            {tab === 'replenish' && <ScmReplenish running={running} onRunPlanner={() => void runPlanner('manual')} />}
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
