'use client';

import { useContext, useMemo, useState } from 'react';
import { ArrowUpRight, Plus, RefreshCw, Settings2, SlidersHorizontal } from '@/ui/icons';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/ui/dialog';
import { useOperationsTables } from '@/hooks/useOperationsTemplate';
import { useTableData } from '@/hooks/useTableData';
import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { OperationsSetup, OPERATIONS_INPUT } from '@/ActivitySpace/sustainment/operations/OperationsSetup';
import { OperationsNavigation, OperationsNavigationContext } from '@/ActivitySpace/sustainment/operations/OperationsNavigation';
import { operationsQueues, operationsQueueLabel, type OperationsQueue } from '@/ActivitySpace/sustainment/operations/operationsQueues';
import { OperationsResults } from '@/ActivitySpace/sustainment/operations/OperationsResults';
import { OperationsRecords } from '@/ActivitySpace/sustainment/operations/OperationsRecords';
import { analyzeOperations, normalizeOperationsParams, OPERATIONS_FIELDS, type OperationsParams } from '@/Function/operations/operationsModel';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';
import { useI18n } from '@/Function/i18n/I18nProvider';

function ScenarioSettings({ params, onApply, onClose }: {
  params: OperationsParams; onApply: (patch: Partial<OperationsParams>) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [days, setDays] = useState(String(params.horizonDays));
  const [followUp, setFollowUp] = useState(String(params.followUpDays));
  const [error, setError] = useState<string | null>(null);
  function apply(event: React.FormEvent) {
    event.preventDefault();
    const horizon = Number(days);
    const value = Number(followUp);
    if (!days.trim() || !Number.isInteger(horizon) || horizon < 1 || horizon > 3650) { setError(t('Use a whole number from 1 to 3650 days.')); return; }
    if (!followUp.trim() || !Number.isInteger(value) || value < 1 || value > 3650) { setError(t('Use a whole number from 1 to 3650 days between contacts.')); return; }
    onApply({ horizonDays: horizon, followUpDays: value });
    onClose();
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent>
      <DialogTitle>{t('Forecast settings')}</DialogTitle>
      <DialogDescription>{t('Choose the forecast period and when an opportunity needs another conversation.')}</DialogDescription>
      <form onSubmit={apply} className="space-y-5">
        <label className="block space-y-2 text-sm"><span>{t('Forecast period (days)')}</span>
          <input autoFocus inputMode="numeric" aria-label={t('Forecast period (days)')} className={`${OPERATIONS_INPUT} bg-muted/40`} value={days} onChange={event => { setDays(event.target.value); setError(null); }} />
        </label>
        <label className="block space-y-2 text-sm"><span>{t('Flag after days without contact')}</span>
          <input inputMode="numeric" aria-label={t('Flag after days without contact')} className={`${OPERATIONS_INPUT} bg-muted/40`} value={followUp} onChange={event => { setFollowUp(event.target.value); setError(null); }} />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" type="button" onClick={onClose}>{t('Cancel')}</Button>
          <Button variant="primary" type="submit">{t('Apply settings')}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}

function Planner({ params, setParams, host }: Omit<WidgetProps, 'params'> & { params: OperationsParams }) {
  const { t } = useI18n();
  const tables = useOperationsTables();
  const eligible = !!params.tableId && tables.data.some(table => table.id === params.tableId);
  const source = useTableData(!tables.loading && !tables.error && eligible ? params.tableId : null);
  const [configureQueue, setConfigureQueue] = useState<OperationsQueue | null>(null);
  const [scenario, setScenario] = useState(false);
  // The receipt belongs to this Table session, even when a view is closed.
  const [createdActions, setCreatedActions] = useState<Record<string, string>>({});
  const [localView, setLocalView] = useState<OperationsQueue>('overview');
  const navigation = useContext(OperationsNavigationContext);
  const view = navigation?.queue ?? localView;
  const setView = navigation?.onSelect ?? setLocalView;
  const [previousView, setPreviousView] = useState(view);
  if (previousView !== view) {
    setPreviousView(view);
    setConfigureQueue(null);
  }
  const configure = configureQueue === view && previousView === view;
  const setConfigure = (open: boolean) => setConfigureQueue(open ? view : null);
  const [selectedRow, setSelectedRow] = useState<string | null | undefined>();
  const data = source.data;
  const today = toDateOnlyString(new Date());
  const analysis = useMemo(() => data ? analyzeOperations(data, params, today) : null, [data, params, today]);
  const queues = analysis ? operationsQueues(analysis) : null;
  // Every write stamps the CRM kind so a placement saved for another kind stops resetting to setup.
  const change = (patch: Partial<OperationsParams> | ((current: OperationsParams) => Partial<OperationsParams>)) => {
    if (typeof patch === 'function') setParams(current => ({ ...patch(normalizeOperationsParams(current)), kind: 'crm' }));
    else setParams({ ...patch, kind: 'crm' });
  };
  useWidgetMeta(data?.table.name ?? null);
  const unavailable = !!params.tableId && !tables.loading && !tables.error && !eligible;
  const needsMapping = !params.tableId || !!data && OPERATIONS_FIELDS.some(field => field.required && !data.columns.some(column => column.id === params.fields[field.key] && field.allowedTypes.includes(column.type)));
  const showSetup = configure || needsMapping || unavailable;

  return <>
    <WidgetHeaderAction>
      {data && host.onNavigate && host.onViewChange && <Button variant="ghost" size="icon-xs" aria-label={t('Open source Table')} onClick={() => { host.onViewChange?.('tables'); host.onNavigate?.({ tableId: data.table.id }); }}><ArrowUpRight size={12} /></Button>}
      {params.tableId && <Button variant="ghost" size="xs" aria-label={t('Data settings')} aria-pressed={configure} disabled={selectedRow !== undefined} onClick={() => setConfigure(!configure)}><Settings2 size={12} /><span className="hidden sm:inline">{t('Data settings')}</span></Button>}
    </WidgetHeaderAction>
    <div className="space-y-5">
      {tables.loading && <p role="status" className="py-6 text-sm text-muted-foreground">{t('Loading your pipeline…')}</p>}
      {tables.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{t('Could not load your data.')} {tables.error instanceof Error ? tables.error.message : ''}</p><Button onClick={tables.refetch}>{t('Retry')}</Button></div>}
      {unavailable && <p role="alert" className="text-sm text-muted-foreground">{t('The connected Table is no longer available here. Choose an available Table below.')}</p>}
      {source.loading && <p role="status" className="py-6 text-sm text-muted-foreground">{t('Loading opportunities…')}</p>}
      {source.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">{t('Could not load this Table.')} {source.error instanceof Error ? source.error.message : ''}</p><Button onClick={() => void source.refetch()}>{t('Retry')}</Button></div>}
      {selectedRow === undefined && !tables.loading && !tables.error && showSetup && <><div role="status" className="space-y-1"><h3 className="text-lg font-semibold">{t(operationsQueueLabel(view))}</h3><p className="text-sm text-muted-foreground">{t('Connect the required data below to open this view.')}</p></div><OperationsSetup params={params} tables={tables.data} columns={data?.columns ?? []} onChange={patch => { setConfigure(true); change(patch); }} onDone={() => setConfigure(false)} /></>}
      {data && analysis && !showSetup && <>
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <OperationsNavigation queue={view} onSelect={setView}
              counts={{ records: data.rows.length, attention: queues?.attention.length, incomplete: queues?.incomplete.length }} />
            <Button variant="primary" onClick={() => setSelectedRow(null)}><Plus size={14} />{t('Add opportunity')}</Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" align="start" onClick={() => setScenario(true)}><SlidersHorizontal size={14} /><span>{t('Next {n} days', { n: params.horizonDays })}</span><span className="text-muted-foreground">· {t('Follow up after {n} days', { n: params.followUpDays })}</span></Button>
            <Button variant="ghost" size="icon-sm" aria-label={t('Refresh plan')} onClick={() => void source.refetch()}><RefreshCw size={14} /></Button>
          </div>
          {data.rows.length > 0 && view !== 'records' && <OperationsResults focus={view} onQueueChange={setView} key={`${view}:${params.horizonDays}:${params.followUpDays}`} analysis={analysis} params={params} onEdit={setSelectedRow} onConfigure={() => setConfigure(true)} createdActions={createdActions} onActionCreated={(rowId, id) => setCreatedActions(current => ({ ...current, [rowId]: id }))} />}
        </>
        {data.rows.length === 0 && view !== 'records' && <div className="space-y-4 py-8 sm:py-12">
          <span className="text-xs font-medium text-muted-foreground">{t('{name} is ready', { name: data.table.name })}</span>
          <div className="space-y-2"><h3 className="text-xl font-semibold">{view === 'overview' ? t('Add your first opportunity') : t(operationsQueueLabel(view))}</h3><p className="text-sm text-muted-foreground">{t('No opportunities have been added yet.')} {view === 'attention' ? t('Add records before checking for risks.') : view === 'incomplete' ? t('There are no records to check for missing details.') : ''}</p><p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{t('Start with a deal you are working on. Its value, likelihood, and next contact will bring this pipeline to life.')}</p></div>
          <p className="text-xs text-muted-foreground">{t('You can update the opportunity as the conversation progresses.')}</p>
        </div>}
      </>}
      {data && analysis && <OperationsRecords data={data} source={source} params={params} selectedRow={selectedRow} onSelect={setSelectedRow} showList={!showSetup && view === 'records'} />}
    </div>
    {scenario && <ScenarioSettings params={params} onApply={change} onClose={() => setScenario(false)} />}
  </>;
}

/** One CRM planner; its source Table and field bindings belong to its placement. */
export default function OperationsPlannerWidget({ params: raw, ...props }: WidgetProps) {
  const params = normalizeOperationsParams(raw);
  return <Planner key={params.tableId ?? 'setup'} {...props} params={params} />;
}
