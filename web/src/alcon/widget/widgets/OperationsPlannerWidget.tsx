'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, RefreshCw, Settings2 } from 'lucide-react';
import { Button } from '@/ui/button';
import { useOperationsTables } from '@/hooks/useOperationsTemplate';
import { useWidgetTableData } from '@/hooks/useWidgetTableData';
import { toDateOnlyString } from '@/alcon/shared/dateUtils';
import { OperationsSetup, OPERATIONS_INPUT } from '@/alcon/sustainment/OperationsSetup';
import { OperationsResults } from '@/alcon/sustainment/OperationsResults';
import { OperationsRecords } from '@/alcon/sustainment/OperationsRecords';
import { analyzeOperations, normalizeOperationsParams, OPERATIONS_FIELDS, type OperationsParams } from '@/alcon/sustainment/operationsModel';
import { WidgetHeaderAction, useWidgetMeta } from '../WidgetFrame';
import type { WidgetProps } from '../types';

function ScenarioValue({ label, value, min, max, integer, onChange }: {
  label: string; value: number; min: number; max: number; integer?: boolean; onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState(false);
  function save() {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < min || next > max || (integer && !Number.isInteger(next))) { setError(true); return; }
    setError(false);
    onChange(next);
  }
  return <label className="min-w-0 space-y-1">
    <span className="block text-xs text-muted-foreground">{label}</span>
    <input className={`${OPERATIONS_INPUT} max-w-32 tabular-nums`} aria-label={label} aria-invalid={error} inputMode={integer ? 'numeric' : 'decimal'} value={draft}
      onChange={event => setDraft(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
    {error && <span role="alert" className="block text-xs text-destructive">Enter {integer ? 'a whole number' : 'a number'} from {min} to {max}.</span>}
  </label>;
}

function Planner({ params, setParams, host }: Omit<WidgetProps, 'params'> & { params: OperationsParams }) {
  const tables = useOperationsTables();
  const eligible = !!params.tableId && tables.data.some(table => table.id === params.tableId);
  const source = useWidgetTableData(!tables.loading && !tables.error && eligible ? params.tableId : null);
  const [configure, setConfigure] = useState(!params.tableId || OPERATIONS_FIELDS[params.kind].some(field => field.required && !params.fields[field.key]));
  const [selectedRow, setSelectedRow] = useState<string | null | undefined>();
  const data = source.data;
  const today = toDateOnlyString(new Date());
  const analysis = useMemo(() => data ? analyzeOperations(data, params, today) : null, [data, params, today]);
  const change = (patch: Partial<OperationsParams>) => setParams(patch);
  useWidgetMeta(data ? `${data.table.name} · ${data.rows.length}` : params.kind.toUpperCase());
  const unavailable = !!params.tableId && !tables.loading && !tables.error && !eligible;

  return <>
    <WidgetHeaderAction>
      {data && host.onNavigate && <Button variant="ghost" size="icon-xs" aria-label="Open source Table" onClick={() => { host.onViewChange?.('tables'); host.onNavigate?.({ tableId: data.table.id }); }}><ArrowUpRight size={12} /></Button>}
      <Button variant="ghost" size="icon-xs" aria-label="Configure operations planner" aria-pressed={configure} disabled={selectedRow !== undefined} onClick={() => setConfigure(current => !current)}><Settings2 size={12} /></Button>
    </WidgetHeaderAction>
    <div className="space-y-6">
      {tables.loading && <p role="status" className="text-sm text-muted-foreground">Loading your Tables…</p>}
      {tables.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">Could not load your Tables. {tables.error instanceof Error ? tables.error.message : ''}</p><Button variant="secondary" onClick={tables.refetch}>Retry</Button></div>}
      {unavailable && <p role="alert" className="text-sm text-muted-foreground">The source Table is unavailable in this Space or is no longer accessible. Choose an available source below.</p>}
      {source.loading && <p role="status" className="text-sm text-muted-foreground">Loading records…</p>}
      {source.error && <div role="alert" className="space-y-2"><p className="text-sm text-destructive">Could not load this Table. {source.error instanceof Error ? source.error.message : ''}</p><Button variant="secondary" onClick={() => void source.refetch()}>Retry</Button></div>}
      {selectedRow === undefined && !tables.loading && !tables.error && (configure || !params.tableId || unavailable) && <OperationsSetup params={params} tables={tables.data} columns={data?.columns ?? []} onChange={change} onDone={() => setConfigure(false)} />}
      {data && analysis && <>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <ScenarioValue key={`horizon:${params.horizonDays}`} label="Planning horizon (days)" value={params.horizonDays} min={1} max={3650} integer onChange={horizonDays => change({ horizonDays })} />
          {params.kind === 'scm'
            ? <ScenarioValue key={`demand:${params.demandMultiplier}`} label="Demand multiplier" value={params.demandMultiplier} min={0} max={100} onChange={demandMultiplier => change({ demandMultiplier })} />
            : <ScenarioValue key={`followup:${params.followUpDays}`} label="Follow-up threshold (days)" value={params.followUpDays} min={1} max={3650} integer onChange={followUpDays => change({ followUpDays })} />}
          <div className="ml-auto flex items-center gap-2 self-end">
            {params.kind === 'scm' && params.demandMultiplier !== 1 && <Button variant="ghost" size="xs" onClick={() => change({ demandMultiplier: 1 })}>Reset demand</Button>}
            <Button variant="ghost" size="sm" onClick={() => void source.refetch()}><RefreshCw size={12} />Refresh</Button>
          </div>
        </div>
        <OperationsResults key={`${params.horizonDays}:${params.demandMultiplier}:${params.followUpDays}`} analysis={analysis} params={params} onEdit={setSelectedRow} editing={selectedRow !== undefined} />
        <OperationsRecords data={data} source={source} params={params} selectedRow={selectedRow} onSelect={setSelectedRow} />
      </>}
    </div>
  </>;
}

/** One analysis widget; mode, source and field bindings belong to its placement. */
export default function OperationsPlannerWidget({ params: raw, ...props }: WidgetProps) {
  const params = normalizeOperationsParams(raw);
  return <Planner key={`${params.kind}:${params.tableId ?? 'setup'}`} {...props} params={params} />;
}
