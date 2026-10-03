'use client';

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/ui/button';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { forecastFor, type CrmWorkspace } from './crmModel';
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
export function CrmForecast({ workspace }: { workspace: CrmWorkspace }) {
  const { t, locale } = useI18n();
  const currencies = workspace.analysis.totals.map(total => total.currency);
  const [chosen, setChosen] = useState<string | null>(null);
  const currency = chosen && currencies.includes(chosen) ? chosen : workspace.primaryCurrency;
  const forecast = useMemo(() => forecastFor(workspace.deals, currency, workspace.today, 6), [workspace, currency]);
  const label = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString(locale, { month: 'short', year: month.slice(0, 4) === workspace.today.slice(0, 4) ? undefined : 'numeric', timeZone: 'UTC' });

  if (!currency) return <p className="py-10 text-sm text-muted-foreground">{t('Add deals with an amount and currency to see a forecast.')}</p>;
  return <div className="space-y-8">
    {currencies.length > 1 && <div role="group" aria-label={t('Currency')} className="flex flex-wrap gap-1">
      {currencies.map(code => <Button key={code} shape="tab" variant={code === currency ? 'secondary' : 'ghost'} aria-pressed={code === currency} onClick={() => setChosen(code)}>{code}</Button>)}
    </div>}
    <dl className="grid grid-cols-2 gap-6 sm:grid-cols-5">
      <Metric label={t('Open pipeline')} value={money(forecast.openPipeline, currency, locale, true)} />
      <Metric label={t('Weighted')} value={money(forecast.weightedPipeline, currency, locale, true)} />
      <Metric label={t('Won to date')} value={money(forecast.wonTotal, currency, locale, true)} />
      <Metric label={t('Win rate')} value={forecast.winRate === null ? '—' : `${Math.round(forecast.winRate * 100)}%`} hint={t('Won ÷ (won + lost)')} />
      <Metric label={t('Average won deal')} value={money(forecast.averageWon, currency, locale, true)} />
    </dl>
    <section aria-label={t('Forecast by close month')} className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <h2 className="mr-auto text-sm font-medium text-foreground">{t('By expected close month')}</h2>
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-[13px] tabular-nums">
        <thead className="text-xs text-muted-foreground"><tr>{['Month', 'Deals', 'Won', 'Commit', 'Weighted', 'Best case'].map(item => <th key={item} scope="col" className="px-2 py-2 font-medium first:pl-0">{t(item)}</th>)}</tr></thead>
        <tbody>{forecast.months.map(month => <tr key={month.month} className="border-t border-[var(--border-subtle)]">
          <td className="py-2 pr-2">{label(month.month)}</td><td className="px-2 py-2">{month.count}</td>
          {[month.won, month.commit, month.weighted, month.bestCase].map((value, index) => <td key={index} className="px-2 py-2">{money(value, currency, locale, true)}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}
