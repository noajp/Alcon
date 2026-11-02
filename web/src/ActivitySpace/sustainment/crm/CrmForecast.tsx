'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useStrategiesInSpace } from '@/hooks/strategyData';
import { forecastFor, type CrmDeal, type CrmWorkspace } from '@/Function/crm/crmModel';
import { money } from './crmFormat';
import { Metric } from './CrmToday';

// Commit sits between weighted and best case; it stays in the table so the
// chart keeps three clearly distinct series.
const SERIES = [
  { key: 'won', label: 'Won', color: SEMANTIC_COLORS.success },
  { key: 'weighted', label: 'Weighted', color: SEMANTIC_COLORS.accent },
  { key: 'bestCase', label: 'Best case', color: 'var(--surface-strong)' },
] as const;

/** Six months by expected close, one currency at a time. */
/** Open, weighted and won per group, for one currency. */
function Breakdown({ title, rows, currency, onOpen }: { title: string; rows: { id: string; label: string; deals: CrmDeal[] }[]; currency: string; onOpen?: (id: string) => void }) {
  const { t, locale } = useI18n();
  const sum = (deals: CrmDeal[], pick: (deal: CrmDeal) => number) => deals.filter(deal => deal.currency === currency).reduce((total, deal) => total + pick(deal), 0);
  const data = rows.map(row => ({ ...row,
    open: sum(row.deals.filter(deal => deal.outcome === 'open'), deal => deal.amount ?? 0),
    weighted: sum(row.deals.filter(deal => deal.outcome === 'open'), deal => deal.weighted ?? 0),
    won: sum(row.deals.filter(deal => deal.outcome === 'won'), deal => deal.amount ?? 0) }))
    .filter(row => row.open || row.won).sort((a, b) => b.weighted + b.won - (a.weighted + a.won));
  if (!data.length) return null;
  return <section className="space-y-1"><h2 className={`${FONT.lg} text-foreground`}>{title}</h2>
    <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-[13px] tabular-nums">
      <thead className="border-b border-[var(--border-subtle)] text-xs text-muted-foreground"><tr>{['', 'Open pipeline', 'Weighted', 'Won'].map(item => <th key={item} scope="col" className="px-2 py-2 font-medium first:pl-0">{item && t(item)}</th>)}</tr></thead>
      <tbody>{data.map(row => <tr key={row.id}>
        <td className="max-w-64 truncate py-2 pr-2">{onOpen && row.id ? <button type="button" className="truncate rounded-sm text-left hover:underline" onClick={() => onOpen(row.id)}>{row.label}</button> : row.label}</td>
        {[row.open, row.weighted, row.won].map((value, index) => <td key={index} className="px-2 py-2">{money(value, currency, locale, true)}</td>)}
      </tr>)}</tbody>
    </table></div></section>;
}

function group(deals: readonly CrmDeal[], key: (deal: CrmDeal) => string | null, label: (id: string) => string) {
  const map = new Map<string, CrmDeal[]>();
  for (const deal of deals) { const id = key(deal) ?? ''; map.set(id, [...(map.get(id) ?? []), deal]); }
  return [...map.entries()].map(([id, items]) => ({ id, label: label(id), deals: items }));
}

export function CrmForecast({ workspace, onOpenInitiative }: { workspace: CrmWorkspace; onOpenInitiative?: (id: string) => void }) {
  const strategies = useStrategiesInSpace();
  const { t, locale } = useI18n();
  const currencies = workspace.totals.map(total => total.currency);
  const [chosen, setChosen] = useState<string | null>(null);
  const currency = chosen && currencies.includes(chosen) ? chosen : workspace.primaryCurrency;
  const forecast = useMemo(() => forecastFor(workspace.deals, currency, workspace.today, 6), [workspace, currency]);
  const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'short', year: month.slice(0, 4) === workspace.today.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' });

  if (!currency) return <p className="py-10 text-sm text-muted-foreground">{t('Add deals with an amount and currency to see a forecast.')}</p>;
  return <div className="space-y-8">
    {currencies.length > 1 && <div role="group" aria-label={t('Currency')} className="flex flex-wrap gap-1">
      {currencies.map(code => <Button key={code} shape="tab" variant={code === currency ? 'secondary' : 'ghost'} aria-pressed={code === currency} onClick={() => setChosen(code)}>{code}</Button>)}
    </div>}
    <dl className="grid grid-cols-2 gap-6 @2xl/crm:grid-cols-5">
      <Metric label={t('Open pipeline')} value={money(forecast.openPipeline, currency, locale, true)} />
      <Metric label={t('Weighted')} value={money(forecast.weightedPipeline, currency, locale, true)} />
      <Metric label={t('Won to date')} value={money(forecast.wonTotal, currency, locale, true)} />
      <Metric label={t('Win rate')} value={forecast.winRate === null ? '—' : `${Math.round(forecast.winRate * 100)}%`} hint={t('Won ÷ (won + lost)')} />
      <Metric label={t('Average won deal')} value={money(forecast.averageWon, currency, locale, true)} />
    </dl>
    <section aria-label={t('Forecast by close month')} className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <h2 className={`${FONT.lg} mr-auto text-foreground`}>{t('By expected close month')}</h2>
        {SERIES.map(series => <span key={series.key} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: series.color }} />{t(series.label)}</span>)}
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={forecast.months} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="month" tickFormatter={label} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
            <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} tickFormatter={value => money(Number(value), currency, locale, true)} />
            <Tooltip cursor={{ fill: 'var(--surface-muted)' }} content={({ active, payload, label: month }) => active && payload?.length ? <div className="rounded-md border border-[var(--border-default)] bg-popover px-3 py-2 text-xs shadow-md">
              <p className="mb-1 font-medium">{label(String(month))}</p>
              {[...SERIES, { key: 'commit', label: 'Commit' } as const].map(series => <p key={series.key} className="flex justify-between gap-4 tabular-nums"><span className="text-muted-foreground">{t(series.label)}</span>{money(Number(payload[0].payload[series.key]), currency, locale)}</p>)}
            </div> : null} />
            {SERIES.map(series => <Bar key={series.key} dataKey={series.key} fill={series.color} radius={[3, 3, 0, 0]} maxBarSize={18} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t('Commit counts open deals at 70% likelihood or more. Weighted multiplies each amount by its likelihood. Overdue open deals are counted in the current month until they are won, lost or re-dated.')}
        {forecast.undated > 0 && ` ${t('{n} open deals have no close date and are not shown.', { n: forecast.undated })}`}</p>
    </section>
    <div className="grid gap-8 @4xl/crm:grid-cols-2">
      <Breakdown title={t('By owner')} currency={currency} rows={group(workspace.deals, deal => deal.ownerId, id => workspace.deals.find(deal => deal.ownerId === id)?.ownerName ?? t('Unassigned'))} />
      <Breakdown title={t('By Initiative')} currency={currency} onOpen={onOpenInitiative} rows={group(workspace.deals, deal => deal.initiativeId, id => strategies.data.find(item => item.id === id)?.name ?? t('Not linked'))} />
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px] tabular-nums">
        <thead className="border-b border-[var(--border-subtle)] text-xs text-muted-foreground"><tr>{['Month', 'Deals', 'Won', 'Commit', 'Weighted', 'Best case'].map(item => <th key={item} scope="col" className="px-2 py-2 font-medium first:pl-0">{t(item)}</th>)}</tr></thead>
        <tbody>{forecast.months.map(month => <tr key={month.month}>
          <td className="py-2 pr-2">{label(month.month)}</td><td className="px-2 py-2">{month.count}</td>
          {[month.won, month.commit, month.weighted, month.bestCase].map((value, index) => <td key={index} className="px-2 py-2">{money(value, currency, locale, true)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
