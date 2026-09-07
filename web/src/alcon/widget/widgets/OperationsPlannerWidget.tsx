'use client';

import { useContext, useMemo, useState } from 'react';
import { ArrowUpRight, Plus, RefreshCw, Settings2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { useOperationsTables } from '@/hooks/useOperationsTemplate';
import { useWidgetTableData } from '@/hooks/useWidgetTableData';
import { toDateOnlyString } from '@/alcon/shared/dateUtils';
import { OperationsSetup, OPERATIONS_INPUT } from '@/alcon/sustainment/OperationsSetup';
import { OperationsNavigation, OperationsNavigationContext } from '@/alcon/sustainment/OperationsNavigation';
import { operationsQueues, type OperationsQueue } from '@/alcon/sustainment/operationsQueues';
import { OperationsResults } from '@/alcon/sustainment/OperationsResults';
import { OperationsRecords } from '@/alcon/sustainment/OperationsRecords';
import { analyzeOperations, normalizeOperationsParams, OPERATIONS_FIELDS, type OperationsParams } from '@/alcon/sustainment/operationsModel';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

function ScenarioSettings({ params, onApply, onClose }: {
  params: OperationsParams; onApply: (patch: Partial<OperationsParams>) => void; onClose: () => void;
}) {
  const crm = params.kind === 'crm';
  const [days, setDays] = useState(String(params.horizonDays));
  const [secondary, setSecondary] = useState(String(crm ? params.followUpDays : params.demandMultiplier));
  const [error, setError] = useState<string | null>(null);
  function apply(event: React.FormEvent) {
    event.preventDefault();
    const horizon = Number(days);
    const value = Number(secondary);
    if (!days.trim() || !Number.isInteger(horizon) || horizon < 1 || horizon > 3650) { setError('Use a whole number from 1 to 3650 days.'); return; }
    if (!secondary.trim() || !Number.isFinite(value) || value < (crm ? 1 : 0) || value > (crm ? 3650 : 100) || (crm && !Number.isInteger(value))) {
      setError(crm ? 'Use a whole number from 1 to 3650 days between contacts.' : 'Use a demand multiplier from 0 to 100.'); return;
    }
    onApply({ horizonDays: horizon, ...(crm ? { followUpDays: value } : { demandMultiplier: value }) });
    onClose();
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogTitle>{crm ? 'Forecast settings' : 'Supply scenario'}</DialogTitle>
      <DialogDescription>{crm ? 'Choose the forecast period and when an opportunity needs another conversation.' : 'Test how demand changes affect stock coverage and suggested orders.'}</DialogDescription>
      <form onSubmit={apply} className="space-y-5">
        <label className="block space-y-2 text-sm"><span>{crm ? 'Forecast period (days)' : 'Plan ahead (days)'}</span>
          <input autoFocus inputMode="numeric" aria-label={crm ? 'Forecast period (days)' : 'Plan ahead (days)'} className={`${OPERATIONS_INPUT} bg-muted/40`} value={days} onChange={event => { setDays(event.target.value); setError(null); }} />
        </label>
        <label className="block space-y-2 text-sm"><span>{crm ? 'Flag after days without contact' : 'Demand multiplier'}</span>
          <input inputMode={crm ? 'numeric' : 'decimal'} aria-label={crm ? 'Flag after days without contact' : 'Demand multiplier'} className={`${OPERATIONS_INPUT} bg-muted/40`} value={secondary} onChange={event => { setSecondary(event.target.value); setError(null); }} />
          {!crm && <span className="block text-xs text-muted-foreground">1× uses recorded daily demand. 1.5× plans for 50% more demand.</span>}
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit">Apply {crm ? 'settings' : 'scenario'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function Planner({ params, setParams, host }: Omit<WidgetProps, 'params'> & { params: OperationsParams }) {
  const tables = useOperationsTables();
  const eligible = !!params.tableId && tables.data.some(table => table.id === params.tableId);
  const source = useWidgetTableData(!tables.loading && !tables.error && eligible ? params.tableId : null);
  const [configure, setConfigure] = useState(!params.tableId || OPERATIONS_FIELDS[params.kind].some(field => field.required && !params.fields[field.key]));
  const [scenario, setScenario] = useState(false);
  // The receipt belongs to this Table session, even when a view is closed.
  const [createdActions, setCreatedActions] = useState<Record<string, string>>({});
  const [localView, setLocalView] = useState<OperationsQueue>('overview');
  const navigation = useContext(OperationsNavigationContext);
  const appNavigation = navigation?.kind === params.kind ? navigation : null;
  const view = appNavigation?.queue ?? localView;
  const setView = appNavigation?.onSelect ?? setLocalView;
  const [selectedRow, setSelectedRow] = useState<string | null | undefined>();
  const data = source.data;
  const today = toDateOnlyString(new Date());
  const analysis = useMemo(() => data ? analyzeOperations(data, params, today) : null, [data, params, today]);
  const queues = analysis ? operationsQueues(analysis) : null;
  const change = (patch: Partial<OperationsParams> | ((current: OperationsParams) => Partial<OperationsParams>)) => {
    if (typeof patch === 'function') setParams(current => patch(normalizeOperationsParams(current)));
    else setParams(patch);
  };
  useWidgetMeta(data?.table.name ?? null);
  const unavailable = !!params.tableId && !tables.loading && !tables.error && !eligible;
  const needsMapping = !params.tableId || !!data && OPERATIONS_FIELDS[params.kind].some(field => field.required && !data.columns.some(column => column.id === params.fields[field.key] && field.allowedTypes.includes(column.type)));
  const showSetup = configure || needsMapping || unavailable;
  const crm = params.kind === 'crm';

  return <>
    <WidgetHeaderAction>
      {data && host.onNavigate && host.onViewChange && <Button variant="ghost" size="icon-xs" aria-label="Open source Table" onClick={() => { host.onViewChange?.('tables'); host.onNavigate?.({ tableId: data.table.id }); }}><ArrowUpRight size={12} /></Button>}
      {params.tableId && <Button variant="ghost" size="xs" aria-label="Data settings" aria-pressed={configure} disabled={selectedRow !== undefined} onClick={() => setConfigure(current => !current)}><Settings2 size={12} /><span className="hidden sm:inline">Data settings</span></Button>}
    </WidgetHeaderAction>
    <div className="space-y-5">
      {tables.loading && <p role="status" className="py-6 text-sm text-muted-foreground">Loading your {crm ? 'pipeline' : 'inventory'}…</p>}
      {tables.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">Could not load your data. {tables.error instanceof Error ? tables.error.message : ''}</p><Button onClick={tables.refetch}>Retry</Button></div>}
      {unavailable && <p role="alert" className="text-sm text-muted-foreground">The connected Table is no longer available here. Choose an available Table below.</p>}
      {source.loading && <p role="status" className="py-6 text-sm text-muted-foreground">Loading {crm ? 'opportunities' : 'inventory'}…</p>}
      {source.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">Could not load this Table. {source.error instanceof Error ? source.error.message : ''}</p><Button onClick={() => void source.refetch()}>Retry</Button></div>}
      {selectedRow === undefined && !tables.loading && !tables.error && showSetup && <OperationsSetup params={params} tables={tables.data} columns={data?.columns ?? []} onChange={patch => { setConfigure(true); change(patch); }} onDone={() => setConfigure(false)} />}
      {data && analysis && !showSetup && <>
        {data.rows.length > 0 ? <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-3">
            <OperationsNavigation kind={params.kind} queue={view} onSelect={setView}
              counts={{ records: data.rows.length, attention: queues?.attention.length, incomplete: queues?.incomplete.length }} />
            <Button variant="primary" onClick={() => setSelectedRow(null)}><Plus size={14} />{crm ? 'Add opportunity' : 'Add item'}</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" align="start" onClick={() => setScenario(true)}><SlidersHorizontal size={14} /><span>Next {params.horizonDays} days</span><span className="text-muted-foreground">· {crm ? `Follow up after ${params.followUpDays} days` : `${params.demandMultiplier}× demand`}</span></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh plan" onClick={() => void source.refetch()}><RefreshCw size={14} /></Button>
          </div>
          {view !== 'records' && <OperationsResults focus={view} onQueueChange={setView} key={`${view}:${params.horizonDays}:${params.demandMultiplier}:${params.followUpDays}`} analysis={analysis} params={params} onEdit={setSelectedRow} onConfigure={() => setConfigure(true)} createdActions={createdActions} onActionCreated={(rowId, id) => setCreatedActions(current => ({ ...current, [rowId]: id }))} />}
        </> : <div className="space-y-4 py-8 sm:py-12">
          <span className="text-xs font-medium text-muted-foreground">{data.table.name} is ready</span>
          <div className="space-y-2"><h3 className="text-xl font-semibold">{crm ? 'Add your first opportunity' : 'Add your first inventory item'}</h3><p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{crm ? 'Start with a deal you are working on. Its value, likelihood, and next contact will bring this pipeline to life.' : 'Start with an item you need to keep in stock. Add what you have and how quickly it is used to see your replenishment plan.'}</p></div>
          <Button variant="primary" size="md" onClick={() => setSelectedRow(null)}><Plus size={14} />{crm ? 'Add opportunity' : 'Add item'}</Button>
          <p className="text-xs text-muted-foreground">{crm ? 'You can update the opportunity as the conversation progresses.' : 'You can add incoming deliveries and adjust demand as plans change.'}</p>
        </div>}
      </>}
      {data && analysis && <OperationsRecords data={data} source={source} params={params} selectedRow={selectedRow} onSelect={setSelectedRow} showList={!showSetup && view === 'records' && data.rows.length > 0} />}
    </div>
    {scenario && <ScenarioSettings params={params} onApply={change} onClose={() => setScenario(false)} />}
  </>;
}

/** One analysis widget; mode, source and field bindings belong to its placement. */
export default function OperationsPlannerWidget({ params: raw, ...props }: WidgetProps) {
  const params = normalizeOperationsParams(raw);
  return <Planner key={`${params.kind}:${params.tableId ?? 'setup'}`} {...props} params={params} />;
}
