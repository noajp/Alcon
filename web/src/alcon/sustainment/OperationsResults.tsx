'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { OperationsAction } from './OperationsAction';
import type { OperationsAnalysis, OperationsParams, SCMRowAnalysis } from './operationsModel';

const quantity = (value: number | null) => value === null ? '—' : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const money = (value: number, currency: string) => `${currency} ${quantity(value)}`;
const evidenceValue = (value: number | null) => value === null ? 'Missing or invalid' : String(value);

function SCMReadings({ row }: { row: SCMRowAnalysis }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-2 py-2 sm:grid-cols-4">
    {[
      ['Days of cover', row.effectiveDailyDemand === 0 ? 'No demand' : quantity(row.daysCover)],
      ['Reorder point', quantity(row.reorderPoint)],
      ['Projected stock', quantity(row.projectedStock)],
      ['Suggested order', row.orderCost !== null && row.currency ? `${quantity(row.recommendedOrder)} units · ${money(row.orderCost, row.currency)}` : quantity(row.recommendedOrder)],
    ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm tabular-nums">{value}</dd></div>)}
  </dl>;
}

export function OperationsResults({ analysis, params, onEdit, editing }: {
  analysis: OperationsAnalysis; params: OperationsParams; onEdit: (rowId: string) => void; editing: boolean;
}) {
  const [limit, setLimit] = useState(8);
  const [stockLimit, setStockLimit] = useState(20);
  const attention = analysis.rows.filter(row => !row.valid || row.signals.length > 0);
  return <div className="space-y-6">
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {[
        ['Records analyzed', analysis.validCount],
        ['Need attention', analysis.riskCount],
        ['Missing or invalid data', analysis.excludedCount],
        [analysis.kind === 'crm' ? 'Open opportunities' : 'Need replenishment', analysis.kind === 'crm' ? analysis.rows.filter(row => row.valid && row.stage === 'open').length : analysis.rows.filter(row => row.valid && (row.recommendedOrder ?? 0) > 0).length],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className={`${FONT['2xl']} tabular-nums`}>{value}</dd></div>)}
    </dl>

    {analysis.issues.length > 0 && <div role="status" className="space-y-1 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">Review the field mapping</p>
      {analysis.issues.map(issue => <p key={issue}>{issue}</p>)}
    </div>}

    {analysis.kind === 'crm' && <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Pipeline and forecast</h3>
        <p className="text-xs text-muted-foreground">{analysis.today} – {analysis.horizonEnd}</p>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        {(['open', 'won', 'lost'] as const).map(stage => <span key={stage}><span className="text-foreground">{stage[0].toUpperCase() + stage.slice(1)}</span> {analysis.rows.filter(row => row.valid && row.stage === stage).length}</span>)}
      </div>
      {analysis.totals.length > 0 ? <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr>
            {['Currency', 'Open pipeline', 'Weighted pipeline', 'Window forecast', 'Won total'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2 font-medium first:pl-0">{label}</th>)}
          </tr></thead>
          <tbody>{analysis.totals.map(total => <tr key={total.currency} className="border-t border-[var(--border-subtle)]">
            {[total.currency, quantity(total.pipeline), quantity(total.weightedPipeline), quantity(total.forecast), quantity(total.won)].map((value, index) => <td key={index} className="whitespace-nowrap px-2 py-2 tabular-nums first:pl-0">{value}</td>)}
          </tr>)}</tbody>
        </table>
      </div> : <p className="text-sm text-muted-foreground">Complete the required values to calculate the forecast.</p>}
      <p className="max-w-4xl text-xs text-muted-foreground">Weighted pipeline = amount × probability ÷ 100 for open opportunities. Window forecast includes open opportunities closing in the dates shown, inclusive. Won total covers all valid won records. Currencies stay separate; records with missing or invalid data are excluded.</p>
    </section>}

    {analysis.kind === 'scm' && <section className="space-y-3">
      <h3 className="text-sm font-medium">Replenishment plan</h3>
      <p className="text-xs text-muted-foreground">{params.horizonDays}-day horizon · {quantity(params.demandMultiplier)}× daily demand · through {analysis.horizonEnd}</p>
      {analysis.totals.length > 0 && <dl className="flex flex-wrap gap-6">
        {analysis.totals.map(total => <div key={total.currency}><dt className="text-xs text-muted-foreground">Suggested spend · {total.itemCount} items</dt><dd className={`${FONT.lg} tabular-nums`}>{money(total.recommendedSpend, total.currency)}</dd></div>)}
      </dl>}
      {analysis.validCount > 0 && <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground"><tr>
            {['Item / SKU', 'Days of cover', 'Reorder point', 'Projected stock', 'Suggested order'].map(label => <th key={label} className="whitespace-nowrap px-2 py-2 font-medium first:pl-0">{label}</th>)}
          </tr></thead>
          <tbody>{analysis.rows.filter(row => row.valid).slice(0, stockLimit).map(row => <tr key={row.rowId} className="border-t border-[var(--border-subtle)]">
            <td className="max-w-64 py-2 pr-2"><Button variant="ghost" size="xs" align="start" disabled={editing} onClick={() => onEdit(row.rowId)} className="max-w-full"><span className="truncate">{row.name}</span></Button></td>
            {[row.effectiveDailyDemand === 0 ? 'No demand' : quantity(row.daysCover), quantity(row.reorderPoint), quantity(row.projectedStock), quantity(row.recommendedOrder)].map((value, index) => <td key={index} className="whitespace-nowrap px-2 py-2 tabular-nums">{value}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
      {analysis.validCount > stockLimit && <Button variant="ghost" onClick={() => setStockLimit(current => current + 20)}>Show more stock calculations ({analysis.validCount - stockLimit} remaining)</Button>}
      <p className="max-w-4xl text-xs text-muted-foreground">Scenario demand = daily demand × multiplier. Reorder point = scenario demand × lead time + safety stock. Suggested orders cover the longer of the horizon or lead time, plus safety stock, less on-hand stock and incoming supply within that window; quantities round up. Projected stock includes arrivals within the horizon. Unreceived overdue supply is excluded, and gaps before arrival are flagged separately.</p>
      <p className="text-xs text-muted-foreground">Each row uses one unit and one expected incoming shipment. Record lead times and arrival dates before using the plan. Currencies stay separate; the scenario recalculates suggestions without placing orders.</p>
    </section>}

    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">Priority actions</h3><span className="text-xs text-muted-foreground">{attention.length} records</span></div>
      {!attention.length && <p className="text-sm text-muted-foreground">{analysis.rows.length ? 'No risks detected with the current data and scenario.' : 'Add records below to identify follow-ups and risks.'}</p>}
      <div className="divide-y divide-[var(--border-subtle)]">
        {attention.slice(0, limit).map(row => {
          const reasons = [...row.issues, ...row.signals.map(signal => signal.message)];
          const evidence = 'account' in row ? [
            `Account: ${row.account ?? 'Missing'}`,
            `Stage: ${row.stage ?? 'Missing or invalid'}`,
            `Amount: ${evidenceValue(row.amount)} ${row.currency ?? '(currency missing)'}`,
            `Probability: ${evidenceValue(row.probability)}%`,
            `Weighted amount: ${evidenceValue(row.weightedAmount)} ${row.currency ?? ''}`,
            `Close date: ${row.closeDate ?? 'Missing'}`,
            `Last contact: ${row.lastContact ?? 'Missing'}`,
            `Next action: ${row.nextActionDate ?? 'Missing'}`,
            `Follow-up threshold: ${params.followUpDays} days`,
          ] : [
            `Supplier: ${row.supplier ?? 'Missing'}`,
            `On hand: ${evidenceValue(row.onHand)}`,
            `Daily demand: ${evidenceValue(row.dailyDemand)}`,
            `Demand multiplier: ${params.demandMultiplier}`,
            `Scenario daily demand: ${evidenceValue(row.effectiveDailyDemand)}`,
            `Lead time: ${evidenceValue(row.leadTimeDays)} days`,
            `Safety stock: ${evidenceValue(row.safetyStock)}`,
            `On order: ${evidenceValue(row.onOrder)}`,
            `Expected arrival: ${row.arrivalDate ?? 'Missing'}`,
            `Unit cost: ${evidenceValue(row.unitCost)} ${row.currency ?? '(currency missing)'}`,
            `Days of cover: ${row.effectiveDailyDemand === 0 ? 'No demand' : evidenceValue(row.daysCover)}`,
            `Reorder point: ${evidenceValue(row.reorderPoint)}`,
            `Target stock: ${evidenceValue(row.targetStock)}`,
            `Projected stock: ${evidenceValue(row.projectedStock)}`,
            `Suggested order: ${evidenceValue(row.recommendedOrder)} units`,
            `Suggested spend: ${evidenceValue(row.orderCost)} ${row.currency ?? ''}`,
            `Shortage before arrival: ${evidenceValue(row.shortageBeforeArrival)} units`,
          ];
          const detail = [`${params.kind.toUpperCase()} analysis as of ${analysis.today}.`,
            `Record: ${row.name}`, `Planning horizon: ${params.horizonDays} days (through ${analysis.horizonEnd})`,
            '', 'Inputs and calculations', ...evidence, '', 'Reasons', ...reasons,
          ].join('\n');
          return <article key={row.rowId} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle size={14} className={row.valid ? 'text-[var(--status-warning)]' : 'text-[var(--status-danger)]'} />
              <h4 className="min-w-0 flex-1 break-words text-sm font-medium">{row.name}</h4>
              {!row.valid && <span className="text-xs text-muted-foreground">Excluded from totals</span>}
              <Button variant="ghost" size="xs" disabled={editing} onClick={() => onEdit(row.rowId)}>Edit record</Button>
              {params.tableId && <OperationsAction tableId={params.tableId} rowId={row.rowId} title={`${params.kind === 'crm' ? 'Follow up' : 'Review supply'}: ${row.name}`} detail={detail} />}
            </div>
            {analysis.kind === 'scm' && row.valid && 'onHand' in row && <SCMReadings row={row} />}
            {analysis.kind === 'crm' && row.valid && 'account' in row && <p className="text-xs text-muted-foreground">
              {[row.account, row.amount !== null && row.currency ? money(row.amount, row.currency) : null, row.probability !== null ? `${row.probability}% probability` : null, row.closeDate ? `Closes ${row.closeDate}` : null].filter(Boolean).join(' · ')}
            </p>}
            <ul className="space-y-1 text-xs text-muted-foreground">{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          </article>;
        })}
      </div>
      {attention.length > limit && <Button variant="ghost" onClick={() => setLimit(current => current + 20)}>Show more actions ({attention.length - limit} remaining)</Button>}
    </section>
  </div>;
}
