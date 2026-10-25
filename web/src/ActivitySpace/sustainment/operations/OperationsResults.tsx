'use client';

import { useState } from 'react';
import { ChevronDown, Info } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { operationsQueues, type OperationsQueue } from './operationsQueues';
import { OperationsAction } from './OperationsAction';
import { operationsText } from './operationsText';
import type { OperationsAnalysis, OperationsParams, CRMRowAnalysis } from './operationsModel';

type Translate = (message: string, values?: Record<string, string | number>) => string;

const disclosure = 'flex w-fit cursor-pointer items-center gap-2 rounded-sm py-2 text-xs text-muted-foreground hover:text-foreground focus-visible:bg-muted';

/** The evidence written into the follow-up Element's description, in the writer's language. */
function actionEvidence(row: CRMRowAnalysis, params: OperationsParams, analysis: OperationsAnalysis, t: Translate, locale: string) {
  const quantity = (value: number | null) => value === null ? t('Missing or invalid') : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const missing = (value: string | null) => value ?? t('Missing');
  const reasons = [...row.issues, ...row.signals.map(signal => signal.message)].map(reason => operationsText(reason, t));
  const evidence = [
    t('Account: {value}', { value: missing(row.account) }),
    t('Stage: {name}', { name: row.stage ? t(row.stage === 'open' ? 'Open' : row.stage === 'won' ? 'Won' : 'Lost') : t('Missing or invalid') }),
    t('Amount: {value} {currency}', { value: quantity(row.amount), currency: row.currency ?? t('(currency missing)') }),
    t('Probability: {value}%', { value: quantity(row.probability) }),
    t('Weighted amount: {value} {currency}', { value: quantity(row.weightedAmount), currency: row.currency ?? '' }),
    t('Close date: {value}', { value: missing(row.closeDate) }),
    t('Last contact: {value}', { value: missing(row.lastContact) }),
    t('Next action: {value}', { value: missing(row.nextActionDate) }),
    t('Follow-up threshold: {n} days', { n: params.followUpDays }),
  ];
  return [t('CRM analysis as of {date}.', { date: analysis.today }),
    t('Record: {name}', { name: row.name }), t('Planning horizon: {n} days (through {date})', { n: params.horizonDays, date: analysis.horizonEnd }),
    '', t('Inputs and calculations'), ...evidence, '', t('Reasons'), ...reasons,
  ].join('\n');
}

function AttentionRow({ row, analysis, params, onEdit, createdId, onCreated }: {
  row: CRMRowAnalysis; analysis: OperationsAnalysis; params: OperationsParams; onEdit: (id: string) => void; createdId?: string; onCreated: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const urgent = row.signals.some(signal => signal.severity === 'high');
  const firstSignal = row.signals.find(signal => signal.severity === 'high') ?? row.signals.find(signal => signal.severity === 'medium');
  const quantity = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 2 });
  return <article className="space-y-2 py-4 first:pt-0">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1 space-y-0.5">
        <button type="button" className="max-w-full text-left text-sm font-medium text-foreground hover:underline" onClick={() => onEdit(row.rowId)}>{row.name}</button>
        <p className="text-xs text-muted-foreground">{row.account}</p>
      </div>
      <span className={`shrink-0 text-xs ${urgent ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>{urgent ? t('Time-sensitive') : t('Follow up')}</span>
    </div>
    <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <span className="inline-flex flex-wrap items-baseline gap-x-1"><span className="text-xs text-muted-foreground">{t('Next contact')}</span>{row.nextActionDate ?? t('Not scheduled')}</span>
      <span className="inline-flex flex-wrap items-baseline gap-x-1"><span className="text-xs text-muted-foreground">{t('Last contact')}</span>{row.lastContact ?? t('Not recorded')}</span>
    </div>
    {firstSignal && <p className="text-sm leading-relaxed text-muted-foreground">{operationsText(firstSignal.message, t)}</p>}
    <ButtonAppearanceProvider appearance="inline">
      <div className="-ml-2.5 flex flex-wrap items-center gap-0.5">
        {params.tableId && <OperationsAction tableId={params.tableId} rowId={row.rowId} createdId={createdId} onCreated={onCreated}
          label={t('Create follow-up')}
          title={t('Follow up: {name}', { name: row.name })} detail={actionEvidence(row, params, analysis, t, locale)} />}
        <Button variant="ghost" size="sm" onClick={() => onEdit(row.rowId)}>{t('Update opportunity')}</Button>
      </div>
    </ButtonAppearanceProvider>
    <details>
      <summary className={disclosure}>{t('Details and reasoning')}</summary>
      <div className="space-y-3 pb-1 text-xs text-muted-foreground">
        <p>{[row.amount !== null && row.currency ? `${row.currency} ${quantity(row.amount)}` : null, row.probability !== null ? t('{p}% likelihood', { p: row.probability }) : null, row.closeDate ? t('Expected close {date}', { date: row.closeDate }) : null].filter(Boolean).join(' · ')}</p>
        <ul className="space-y-2">{row.signals.map(signal => <li key={signal.code}>{operationsText(signal.message, t)}</li>)}</ul>
      </div>
    </details>
  </article>;
}

export function OperationsResults({ analysis, params, onEdit, onConfigure, createdActions, onActionCreated, focus = 'overview', onQueueChange }: {
  focus?: Exclude<OperationsQueue, 'records'>; onQueueChange?: (queue: OperationsQueue) => void;
  analysis: OperationsAnalysis; params: OperationsParams; onEdit: (rowId: string) => void; onConfigure: () => void; createdActions: Record<string, string>; onActionCreated: (rowId: string, id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [limit, setLimit] = useState(8);
  const { attention, incomplete } = operationsQueues(analysis);
  const quantity = (value: number | null) => value === null ? '—' : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const stageLabel = { open: t('Open'), won: t('Won'), lost: t('Lost') } as const;

  return <div className="space-y-6 py-2">
    {analysis.issues.length > 0 && <div role="status" className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{t('Some columns need reconnecting before all details can be used.')}</span>
        <ButtonAppearanceProvider appearance="inline"><Button variant="ghost" size="sm" className="-ml-2.5" onClick={onConfigure}>{t('Review data settings')}</Button></ButtonAppearanceProvider>
      </div>
      <ul className="space-y-1 text-xs text-muted-foreground">{analysis.issues.map(issue => <li key={issue}>{operationsText(issue, t)}</li>)}</ul>
    </div>}
    <div className={focus === 'overview' ? 'grid items-start gap-10 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : 'max-w-3xl'}>
      <div className="min-w-0 space-y-6">
        {focus !== 'incomplete' && <section className="space-y-3">
          <div className="space-y-0.5">
            <h3 className={`${FONT.lg} text-foreground`}>{t('Follow-ups')} <span className="ml-1 tabular-nums text-muted-foreground">{attention.length}</span></h3>
            <p className={`${FONT.sm} text-muted-foreground`}>{t('Keep these conversations moving.')}</p>
          </div>
          {!attention.length ? <p className={`${FONT.base} text-muted-foreground`}>{analysis.validCount
            ? `${t('No follow-ups flagged. Based on {n} complete opportunities and the current plan.', { n: analysis.validCount })}${incomplete.length ? ` ${t('Incomplete entries still need review.')}` : ''}`
            : t('More details are needed. Complete missing details to see what needs attention.')}</p>
            : <div>{attention.slice(0, limit).map(row => <AttentionRow key={row.rowId} row={row} analysis={analysis} params={params} onEdit={onEdit} createdId={createdActions[row.rowId]} onCreated={id => onActionCreated(row.rowId, id)} />)}</div>}
          {attention.length > limit && <Button variant="ghost" onClick={() => setLimit(current => current + 20)}>{t('Show more ({n} remaining)', { n: attention.length - limit })}</Button>}
        </section>}
        {focus === 'attention' && incomplete.length > 0 && <Button variant="secondary" onClick={() => onQueueChange?.('incomplete')}>{t('Review missing details ({n})', { n: incomplete.length })}</Button>}
        {focus === 'incomplete' && incomplete.length === 0 && <div className="space-y-1 py-2"><h3 className={`${FONT.lg} text-foreground`}>{t('No missing details')}</h3><p className={`${FONT.sm} text-muted-foreground`}>{t('All entries have the required details for the current plan. Optional information may still be added.')}</p></div>}
        {focus !== 'attention' && incomplete.length > 0 && <details open={focus === 'incomplete' ? true : undefined}>
          <summary className="flex cursor-pointer items-center gap-2 rounded-sm py-2 text-sm hover:bg-muted/40 focus-visible:bg-muted"><Info size={16} className="text-muted-foreground" /><span>{t('{n} opportunities need more details', { n: incomplete.length })}</span><ChevronDown size={14} className="ml-auto" /></summary>
          <p className="py-2 text-xs text-muted-foreground">{t('These entries are excluded from totals. Complete their details to include them.')}</p>
          <ul>{incomplete.map(row => <li key={row.rowId} className="space-y-1 py-2">
            <div className="flex items-center justify-between gap-2"><span className="min-w-0 break-words text-sm font-medium">{row.name}</span>
              <ButtonAppearanceProvider appearance="inline"><Button variant="ghost" size="sm" onClick={() => onEdit(row.rowId)}>{t('Complete details')}</Button></ButtonAppearanceProvider></div>
            <ul className="space-y-1 text-xs text-muted-foreground">{row.issues.map(issue => <li key={issue}>{operationsText(issue, t)}</li>)}</ul>
          </li>)}</ul>
        </details>}
      </div>
      {focus === 'overview' && <aside className="min-w-0 space-y-5">
        <div className="space-y-0.5"><h3 className={`${FONT.lg} text-foreground`}>{t('Expected to close')}</h3><p className={`${FONT.sm} text-muted-foreground`}>{analysis.today} – {analysis.horizonEnd}</p></div>
        <dl className="space-y-6">{analysis.totals.map(total => <div key={total.currency} className="space-y-3">
          <div className="space-y-0.5"><dt className={`${FONT.sm} text-muted-foreground`}>{t('{currency} · Weighted forecast', { currency: total.currency })}</dt><dd className={`${FONT['2xl']} tabular-nums text-foreground`}>{quantity(total.forecast)}</dd></div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs"><div><dt className="text-muted-foreground">{t('Open pipeline')}</dt><dd className="mt-1 tabular-nums">{quantity(total.pipeline)}</dd></div><div><dt className="text-muted-foreground">{t('Won total')}</dt><dd className="mt-1 tabular-nums">{quantity(total.won)}</dd></div></div>
          <p className="text-xs text-muted-foreground">{t('{n} open · {amount} weighted across all dates', { n: total.openCount, amount: quantity(total.weightedPipeline) })}</p>
        </div>)}</dl>
        <p className="text-xs text-muted-foreground">{(['open', 'won', 'lost'] as const).map(stage => t('{n} {stage}', { n: analysis.rows.filter(row => row.valid && row.stage === stage).length, stage: stageLabel[stage] })).join(' · ')}</p>
        {!analysis.totals.length && <p className="text-sm text-muted-foreground">{analysis.validCount ? t('No open or won opportunities to total.') : t('Complete the required details to calculate an estimate.')}</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">{t('Forecast weights open opportunities by their likelihood of closing in this period. Currencies are kept separate.')}</p>
        <details>
          <summary className={disclosure}>{t('How this is calculated')}</summary>
          <div className="space-y-3 text-xs leading-relaxed text-muted-foreground"><p>{t('Weighted pipeline = amount × probability ÷ 100 for open opportunities. The forecast includes closing dates within the dates shown, inclusive. Won total covers all valid won opportunities. Missing or invalid entries are excluded.')}</p></div>
        </details>
      </aside>}
    </div>
  </div>;
}
