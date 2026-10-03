'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/ui/button';
import { ScmIcon } from '@/Function/shared/conceptIcons';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { askCopilot } from '@/Function/copilot/copilotBridge';
import { useScmActions, useScmData, useScmPlan } from '@/hooks/useScm';
import type { NavigationState } from '@/types/navigation';
import { explainProposal } from './scmText';
import { SCM_VIEW_LABEL, scmViewOf, type ScmView as ScmPane } from './scmNavigation';
import { ScmSurfaceContext, type ScmDialog, type ScmSurface } from './scmSurface';
import { ItemDialog, MovementDialog, NewOrderDialog, OrderDialog, SupplierDialog } from './ScmForms';
import { ScmTower } from './ScmTower';
import { ScmExceptions, ScmInventory, ScmOrders, ScmSuppliers } from './ScmLists';
import { ScmReplenish } from './ScmReplenish';
import { ScmItemDetail } from './ScmItemDetail';
import { ScmScenarios } from './ScmScenarios';
import { ScmDataSection, ScmImport, ScmLocations, ScmOnboarding, ScmPolicyForm } from './ScmSettings';

const DESCRIPTION: Record<ScmPane, string> = {
  tower: 'What runs out, what to order, and what the autopilot did.',
  exceptions: 'Items that need a decision, soonest first.',
  replenish: 'Orders the planner proposes, with the evidence for each line.',
  orders: 'Every purchase order, from draft to received.',
  inventory: 'Stock, demand and cover for every item at every location.',
  suppliers: 'How each supplier really delivers.',
  scenarios: 'Change an assumption and see what breaks.',
  settings: 'The policy the planner works within, locations, and data.',
};

/** Autopilot runs at most once a day, the first time SCM is opened. */
const AUTOPILOT_INTERVAL_MS = 20 * 60 * 60 * 1000;

export function ScmView({ navigation, onNavigate }: { navigation: NavigationState; onNavigate: (navigation: Partial<NavigationState>) => void }) {
  const { t, locale } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data, loading, error, refetch } = useScmData(spaceId);
  const plan = useScmPlan(data);
  const actions = useScmActions(spaceId);
  const view = scmViewOf(navigation);
  const locationId = navigation.scmLocationId && data?.locations.some(location => location.id === navigation.scmLocationId) ? navigation.scmLocationId : null;
  const [dialog, setDialog] = useState<ScmDialog | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const nodes = useMemo(() => plan?.nodes.filter(node => !locationId || node.locationId === locationId) ?? [], [plan, locationId]);
  const go = useCallback((next: ScmPane, extra: Partial<NavigationState> = {}) => {
    onNavigate({ scmView: next, scmNode: null, scmHealth: null, scmSupplierDelay: null, ...extra });
  }, [onNavigate]);
  // A new pane or item starts at the top.
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [view, navigation.scmNode]);

  /** daily: the automatic pass on opening SCM. manual: the button, scoped to
   * the selected location; with the autopilot off it drafts everything for approval. */
  const runPlanner = useCallback(async (trigger: 'daily' | 'manual') => {
    if (!data || !plan) return;
    const mode = data.policy.autopilotEnabled ? 'autopilot' as const : 'draft' as const;
    const proposals = trigger === 'manual' && locationId ? plan.proposals.filter(proposal => proposal.locationId === locationId) : plan.proposals;
    setRunning(true); setRunError(null);
    try {
      const result = await actions.placeProposals(proposals, { mode, policy: data.policy, today: data.today, minHoursSinceLastRun: trigger === 'daily' ? AUTOPILOT_INTERVAL_MS / 3_600_000 : undefined, explain: proposal => explainProposal(proposal, plan, t, locale, mode) });
      if (result === null && trigger === 'manual') setRunError(t('The planner ran moments ago in another window. Refresh to see its orders.'));
    } catch (cause) {
      setRunError(cause instanceof Error ? cause.message : String(cause));
    } finally { setRunning(false); }
  }, [actions, data, plan, t, locale, locationId]);

  // The daily autopilot pass. Guarded per Space and per session so two
  // renders or two panes never run it twice.
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    if (!data || !plan || !data.policy.autopilotEnabled || running || autoRan.current === data.spaceId) return;
    const last = data.runs[0] ? Date.parse(data.runs[0].ranAt) : 0;
    if (Date.now() - last < AUTOPILOT_INTERVAL_MS || !plan.proposals.length) return;
    // Marked when the run actually starts, so a cancelled timer (StrictMode,
    // a dependency change) does not swallow the day's run.
    const spaceId = data.spaceId;
    const timer = setTimeout(() => { autoRan.current = spaceId; void runPlanner('daily'); }, 0);
    return () => clearTimeout(timer);
  }, [data, plan, running, runPlanner]);

  const surface = useMemo<ScmSurface | null>(() => data && plan ? {
    data, plan, actions, locationId, nodes, go,
    openNode: key => onNavigate({ scmNode: key }),
    openOrder: id => onNavigate({ scmOrderId: id }),
    openDialog: setDialog,
    askCopilot: text => askCopilot({ text, viewLabel: `SCM › ${t(SCM_VIEW_LABEL[view])}`, spaceId: data.spaceId }),
    locationName: id => data.locations.find(location => location.id === id)?.name ?? '—',
    supplierName: id => (id && data.suppliers.find(supplier => supplier.id === id)?.name) || t('No supplier'),
  } : null, [data, plan, actions, locationId, nodes, go, onNavigate, t, view]);

  if (!spaceId) return <Frame><p className="py-12 text-center text-sm text-muted-foreground">{t('Choose or create a Space to use SCM. Supply chain data belongs to a Space and is shared with its members.')}</p></Frame>;
  if (loading) return <Frame><div className="space-y-4 py-6">{[0, 1, 2].map(index => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted/50" />)}</div></Frame>;
  if (error || !data || !plan || !surface) return <Frame><div role="alert" className="space-y-3 py-12 text-center"><p className="text-sm text-destructive">{t('Could not load SCM.')} {error?.message}</p><Button onClick={() => void refetch()}>{t('Retry')}</Button></div></Frame>;

  const empty = !data.items.length;
  const node = navigation.scmNode ? plan.nodes.find(entry => entry.key === navigation.scmNode) ?? null : null;

  return <ScmSurfaceContext.Provider value={surface}>
    <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto bg-card">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8 sm:py-8">
        {!node && <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><ScmIcon size={16} />SCM{locationId && <> · {surface.locationName(locationId)}</>}</div>
            <h1 className="text-2xl font-semibold">{empty ? t('Supply chain') : t(SCM_VIEW_LABEL[view])}</h1>
            {!empty && <p className="text-sm text-muted-foreground">{t(DESCRIPTION[view])}</p>}
          </div>
          {!empty && <Button variant="ghost" size="icon-sm" aria-label={t('Refresh')} onClick={() => void refetch()}><RefreshCw size={14} /></Button>}
        </header>}
        {runError && <p role="alert" className="text-sm text-destructive">{runError}</p>}
        {empty ? <ScmOnboarding data={data} actions={actions} onAddItem={() => setDialog({ kind: 'item', item: null })} />
          : node ? <ScmItemDetail key={node.key} node={node} onBack={() => onNavigate({ scmNode: null })} />
          : navigation.scmNode ? <div className="space-y-3 py-12 text-center"><p className="text-sm text-muted-foreground">{t('This item is no longer planned here.')}</p><Button onClick={() => onNavigate({ scmNode: null })}>{t('Back')}</Button></div>
          : <>
            {view === 'tower' && <ScmTower running={running} onRunPlanner={() => void runPlanner('manual')} />}
            {view === 'exceptions' && <ScmExceptions />}
            {view === 'replenish' && <ScmReplenish running={running} onRunPlanner={() => void runPlanner('manual')} />}
            {view === 'orders' && <ScmOrders />}
            {view === 'inventory' && <ScmInventory health={navigation.scmHealth ?? null} onHealth={health => onNavigate({ scmHealth: health })} />}
            {view === 'suppliers' && <ScmSuppliers />}
            {view === 'scenarios' && <ScmScenarios key={navigation.scmSupplierDelay ?? 'none'} supplierDelay={navigation.scmSupplierDelay ?? null} />}
            {view === 'settings' && <div className="space-y-12">
              <ScmPolicyForm key={`${data.spaceId}:${data.hasPolicy}`} data={data} actions={actions} />
              <ScmLocations data={data} actions={actions} />
              <ScmImport data={data} actions={actions} />
              <ScmDataSection data={data} actions={actions} />
            </div>}
          </>}
      </div>
    </div>
    {dialog?.kind === 'item' && <ItemDialog data={data} actions={actions} item={dialog.item} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'supplier' && <SupplierDialog data={data} actions={actions} supplierId={dialog.supplierId} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'movement' && <MovementDialog data={data} actions={actions} initial={dialog.initial} onClose={() => setDialog(null)} />}
    {dialog?.kind === 'new-order' && <NewOrderDialog data={data} actions={actions} initial={dialog.initial} onClose={() => setDialog(null)} />}
    {navigation.scmOrderId && <OrderDialog key={navigation.scmOrderId} data={data} actions={actions} orderId={navigation.scmOrderId} onClose={() => onNavigate({ scmOrderId: null })}
      onOpenNode={key => onNavigate({ scmOrderId: null, scmNode: key })} />}
  </ScmSurfaceContext.Provider>;
}

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1 overflow-y-auto bg-card"><div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</div></div>;
}
