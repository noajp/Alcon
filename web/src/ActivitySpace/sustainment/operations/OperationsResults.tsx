'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, Info } from 'lucide-react';
import { Button } from '@/ui/button';
import { operationsQueues, type OperationsQueue } from './operationsQueues';
import { OperationsAction } from './OperationsAction';
import type { OperationsAnalysis, OperationsParams, CRMRowAnalysis } from './operationsModel';

const quantity = (value: number | null) => value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const money = (value: number, currency: string) => `${currency} ${quantity(value)}`;
const evidenceValue = (value: number | null) => value === null ? 'Missing or invalid' : String(value);
const disclosure = 'flex w-fit cursor-pointer items-center gap-2 rounded-sm py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:bg-muted';

function actionEvidence(row: CRMRowAnalysis, params: OperationsParams, analysis: OperationsAnalysis) {
  const reasons = [...row.issues, ...row.signals.map(signal => signal.message)];
  const evidence = [
    `Account: ${row.account ?? 'Missing'}`,
    `Stage: ${row.stage ?? 'Missing or invalid'}`,
    `Amount: ${evidenceValue(row.amount)} ${row.currency ?? '(currency missing)'}`,
    `Probability: ${evidenceValue(row.probability)}%`,
    `Weighted amount: ${evidenceValue(row.weightedAmount)} ${row.currency ?? ''}`,
    `Close date: ${row.closeDate ?? 'Missing'}`,
    `Last contact: ${row.lastContact ?? 'Missing'}`,
    `Next action: ${row.nextActionDate ?? 'Missing'}`,
    `Follow-up threshold: ${params.followUpDays} days`,
  ];
  const detail = [`CRM analysis as of ${analysis.today}.`,
    `Record: ${row.name}`, `Planning horizon: ${params.horizonDays} days (through ${analysis.horizonEnd})`,
    '', 'Inputs and calculations', ...evidence, '', 'Reasons', ...reasons,
  ].join('\n');
  return detail;
}

function AttentionRow({ row, analysis, params, onEdit, createdId, onCreated }: {
  row: CRMRowAnalysis; analysis: OperationsAnalysis; params: OperationsParams; onEdit: (id: string) => void; createdId?: string; onCreated: (id: string) => void;
}) {
  const urgent = row.signals.some(signal => signal.severity === 'high');
  const firstSignal = row.signals.find(signal => signal.severity === 'high') ?? row.signals.find(signal => signal.severity === 'medium');
  return <article className="space-y-3 py-5 first:pt-0">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 space-y-1">
        <Button variant="ghost" align="start" className="h-auto max-w-full whitespace-normal p-0 text-sm font-medium" onClick={() => onEdit(row.rowId)}>{row.name}</Button>
        <p className="text-xs text-muted-foreground">{row.account}</p>
      </div>
      <span className={`shrink-0 rounded-sm px-2 py-1 text-xs ${urgent ? 'bg-[var(--status-danger-subtle)] text-[var(--status-danger)]' : 'bg-[var(--status-warning-subtle)] text-[var(--status-warning)]'}`}>{urgent ? 'Time-sensitive' : 'Follow up'}</span>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      <span className="inline-flex flex-wrap items-baseline gap-x-1"><span className="text-xs text-muted-foreground">Next contact</span>{row.nextActionDate ?? 'Not scheduled'}</span>
      <span className="inline-flex flex-wrap items-baseline gap-x-1"><span className="text-xs text-muted-foreground">Last contact</span>{row.lastContact ?? 'Not recorded'}</span>
    </div>
    <p className="text-sm leading-relaxed text-muted-foreground">{firstSignal?.message}</p>
    <div className="flex flex-wrap items-center gap-2">
      {params.tableId && <OperationsAction tableId={params.tableId} rowId={row.rowId} createdId={createdId} onCreated={onCreated}
        label="Create follow-up"
        title={`Follow up: ${row.name}`} detail={actionEvidence(row, params, analysis)} />}
      <Button variant="ghost" size="sm" onClick={() => onEdit(row.rowId)}>Update opportunity</Button>
    </div>
    <details>
      <summary className={disclosure}>Details and reasoning</summary>
      <div className="space-y-3 pb-1 text-xs text-muted-foreground">
        <p>{[row.amount !== null && row.currency ? money(row.amount, row.currency) : null, row.probability !== null ? `${row.probability}% likelihood` : null, row.closeDate ? `Expected close ${row.closeDate}` : null].filter(Boolean).join(' · ')}</p>
        <ul className="space-y-2">{row.signals.map(signal => <li key={signal.code}>{signal.message}</li>)}</ul>
      </div>
    </details>
  </article>;
}

export function OperationsResults({ analysis, params, onEdit, onConfigure, createdActions, onActionCreated, focus = 'overview', onQueueChange }: {
  focus?: Exclude<OperationsQueue, 'records'>; onQueueChange?: (queue: OperationsQueue) => void;
  analysis: OperationsAnalysis; params: OperationsParams; onEdit: (rowId: string) => void; onConfigure: () => void; createdActions: Record<string, string>; onActionCreated: (rowId: string, id: string) => void;
}) {
  const [limit, setLimit] = useState(8);
  const { attention, incomplete } = operationsQueues(analysis);

  return <div className="space-y-6 py-2">
    {analysis.issues.length > 0 && <div role="status" className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 text-sm">
      <span>Some columns need reconnecting before all details can be used.</span><Button variant="secondary" onClick={onConfigure}>Review data settings</Button>
      <ul className="w-full space-y-1 text-xs text-muted-foreground">{analysis.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
    </div>}
    <div className={focus === 'overview' ? "grid items-start gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]" : "max-w-3xl"}>
      <div className="min-w-0 space-y-6">
        {focus !== 'incomplete' && <section className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1"><h3 className="text-lg font-semibold">Follow-ups</h3><p className="text-xs text-muted-foreground">Keep these conversations moving.</p></div>
            <span className="rounded-sm bg-muted px-2 py-1 text-xs tabular-nums">{attention.length}</span>
          </div>
          {!attention.length ? <div className="flex gap-3 py-4"><CheckCircle2 size={20} className="shrink-0 text-muted-foreground" /><div className="space-y-1"><p className="text-sm font-medium">{analysis.validCount ? 'No follow-ups flagged' : 'More details are needed'}</p><p className="text-xs leading-relaxed text-muted-foreground">{analysis.validCount ? `Based on ${analysis.validCount} complete opportunities and the current plan.${incomplete.length ? ' Incomplete entries still need review.' : ''}` : 'Complete missing details to see what needs attention.'}</p></div></div>
            : <div className="divide-y divide-[var(--border-subtle)]">{attention.slice(0, limit).map(row => <AttentionRow key={row.rowId} row={row} analysis={analysis} params={params} onEdit={onEdit} createdId={createdActions[row.rowId]} onCreated={id => onActionCreated(row.rowId, id)} />)}</div>}
          {attention.length > limit && <Button variant="ghost" onClick={() => setLimit(current => current + 20)}>Show more ({attention.length - limit} remaining)</Button>}
        </section>}
        {focus === 'attention' && incomplete.length > 0 && <Button variant="secondary" onClick={() => onQueueChange?.('incomplete')}>Review missing details ({incomplete.length})</Button>}
        {focus === 'incomplete' && incomplete.length === 0 && <div className="space-y-2 py-4"><h3 className="text-lg font-semibold">No missing details</h3><p className="text-sm text-muted-foreground">All entries have the required details for the current plan. Optional information may still be added.</p></div>}
        {focus !== 'attention' && incomplete.length > 0 && <details open={focus === 'incomplete' ? true : undefined} className="border-t border-[var(--border-subtle)] pt-3">
          <summary className="flex cursor-pointer items-center gap-2 rounded-sm py-2 text-sm hover:bg-muted/40 focus-visible:bg-muted"><Info size={16} className="text-muted-foreground" /><span>{incomplete.length} {incomplete.length === 1 ? 'opportunity needs' : 'opportunities need'} more details</span><ChevronDown size={14} className="ml-auto" /></summary>
          <p className="py-2 text-xs text-muted-foreground">These entries are excluded from totals. Complete their details to include them.</p>
          <ul className="divide-y divide-[var(--border-subtle)]">{incomplete.map(row => <li key={row.rowId} className="space-y-2 py-3">
            <div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words text-sm font-medium">{row.name}</span><Button variant="secondary" onClick={() => onEdit(row.rowId)}>Complete details</Button></div>
            <ul className="space-y-1 text-xs text-muted-foreground">{row.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
          </li>)}</ul>
        </details>}
      </div>
      {focus === 'overview' && <aside className="min-w-0 space-y-5 border-t border-[var(--border-subtle)] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <div className="space-y-1"><h3 className="text-sm font-medium">Expected to close</h3><p className="text-xs text-muted-foreground">{analysis.today} – {analysis.horizonEnd}</p></div>
        <dl className="space-y-6">{analysis.totals.map(total => <div key={total.currency} className="space-y-3">
          <div><dt className="text-xs text-muted-foreground">{total.currency} · Weighted forecast</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{quantity(total.forecast)}</dd></div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs"><div><dt className="text-muted-foreground">Open pipeline</dt><dd className="mt-1 tabular-nums">{quantity(total.pipeline)}</dd></div><div><dt className="text-muted-foreground">Won total</dt><dd className="mt-1 tabular-nums">{quantity(total.won)}</dd></div></div>
          <p className="text-xs text-muted-foreground">{total.openCount} open · {quantity(total.weightedPipeline)} weighted across all dates</p>
        </div>)}</dl>
        <p className="text-xs text-muted-foreground">{(['open', 'won', 'lost'] as const).map(stage => `${analysis.rows.filter(row => row.valid && row.stage === stage).length} ${stage}`).join(' · ')}</p>
        {!analysis.totals.length && <p className="text-sm text-muted-foreground">{analysis.validCount ? 'No open or won opportunities to total.' : 'Complete the required details to calculate an estimate.'}</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">Forecast weights open opportunities by their likelihood of closing in this period. Currencies are kept separate.</p>
        <details className="border-t border-[var(--border-subtle)] pt-2">
          <summary className={disclosure}>How this is calculated</summary>
          <div className="space-y-3 text-xs leading-relaxed text-muted-foreground"><p>Weighted pipeline = amount × probability ÷ 100 for open opportunities. The forecast includes closing dates within the dates shown, inclusive. Won total covers all valid won opportunities. Missing or invalid entries are excluded.</p></div>
        </details>
      </aside>}
    </div>
  </div>;
}
