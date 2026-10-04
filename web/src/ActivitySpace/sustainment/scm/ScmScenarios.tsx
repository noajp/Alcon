'use client';

import { useMemo, useState } from 'react';
import { MessageSquare, RotateCcw } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useScmScenario } from '@/hooks/useScm';
import type { ScmScenario } from './scmEngine';
import { formatDay, formatMoney } from './scmText';
import { Kpi, Section, SCM_INPUT, SCM_LABEL, SCM_ROW } from './ScmParts';
import { useScmSurface } from './scmSurface';

interface Draft { demand: number; categories: Record<string, number>; delays: Record<string, number>; serviceLevel: number | null }
const EMPTY: Draft = { demand: 100, categories: {}, delays: {}, serviceLevel: null };

function toScenario(draft: Draft): ScmScenario | null {
  const scenario: ScmScenario = {};
  if (draft.demand !== 100) scenario.demandMultiplier = draft.demand / 100;
  const categories = Object.fromEntries(Object.entries(draft.categories).filter(([, value]) => value !== 100).map(([key, value]) => [key, value / 100]));
  if (Object.keys(categories).length) scenario.categoryDemand = categories;
  const delays = Object.fromEntries(Object.entries(draft.delays).filter(([, value]) => value > 0));
  if (Object.keys(delays).length) scenario.supplierDelays = delays;
  if (draft.serviceLevel !== null) scenario.serviceLevel = draft.serviceLevel / 100;
  return Object.keys(scenario).length ? scenario : null;
}

/** What-if: change demand, delay a supplier or raise the service target, and see what breaks. */
export function ScmScenarios({ supplierDelay }: { supplierDelay: string | null }) {
  const { t, locale } = useI18n();
  const { data, openNode, askCopilot, locationName } = useScmSurface();
  const [draft, setDraft] = useState<Draft>(() => supplierDelay ? { ...EMPTY, delays: { [supplierDelay]: 14 } } : EMPTY);
  const [serviceText, setServiceText] = useState('');
  /** Presets and reset replace every assumption, the typed service level included. */
  const choose = (next: Draft) => { setDraft(next); setServiceText(next.serviceLevel === null ? '' : String(next.serviceLevel)); };
  const scenario = useMemo(() => toScenario(draft), [draft]);
  const result = useScmScenario(data, scenario);
  const categories = useMemo(() => [...new Set(data.items.map(item => item.category).filter(Boolean) as string[])].sort(), [data.items]);
  const currency = data.policy.currency;
  const presets: { label: string; draft: Draft }[] = [
    { label: t('Peak season: demand +30%'), draft: { ...EMPTY, demand: 130 } },
    { label: t('Demand drops 25%'), draft: { ...EMPTY, demand: 75 } },
    ...data.suppliers.slice(0, 3).map(supplier => ({ label: t('{name} is 14 days late', { name: supplier.name }), draft: { ...EMPTY, delays: { [supplier.id]: 14 } } })),
    { label: t('Service level 99%'), draft: { ...EMPTY, serviceLevel: 99 } },
  ];

  function describe() {
    const parts: string[] = [];
    if (draft.demand !== 100) parts.push(t('demand at {n}%', { n: draft.demand }));
    for (const [category, value] of Object.entries(draft.categories)) if (value !== 100) parts.push(t('{category} demand at {n}%', { category, n: value }));
    for (const [id, days] of Object.entries(draft.delays)) if (days > 0) parts.push(t('{name} {n} days late', { name: data.suppliers.find(supplier => supplier.id === id)?.name ?? '', n: days }));
    if (draft.serviceLevel !== null) parts.push(t('service level {n}%', { n: draft.serviceLevel }));
    return parts.join(', ');
  }

  const money = (map: Record<string, number>) => formatMoney(map[currency] ?? 0, currency, locale);
  const fill = (map: Record<string, number | null>) => map[currency] === null || map[currency] === undefined ? '—' : `${((map[currency] ?? 0) * 100).toFixed(1)}%`;

  return <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
    <div className="space-y-6">
      <Section title={t('Assumptions')} description={t('Scenarios change the calculation only. No record or setting is touched.')}
        action={<Button size="sm" variant="ghost" onClick={() => choose(EMPTY)}><RotateCcw size={14} />{t('Reset')}</Button>}>
        <div className="flex flex-wrap gap-1.5">{presets.map(preset => <Button key={preset.label} size="xs" variant="ghost" onClick={() => choose(preset.draft)}>{preset.label}</Button>)}</div>
        <label className={SCM_LABEL}><span>{t('All demand: {n}%', { n: draft.demand })}</span>
          <input type="range" min={25} max={300} step={5} className="w-full accent-[var(--accent-default)]" value={draft.demand} onChange={event => setDraft(current => ({ ...current, demand: Number(event.target.value) }))} />
        </label>
        {categories.length > 0 && <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('By category')}</p>
          {categories.map(category => <label key={category} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 text-sm">
            <span className="truncate">{category}</span>
            <input aria-label={t('{category} demand %', { category })} inputMode="numeric" className={`${SCM_INPUT} text-right`} value={draft.categories[category] ?? 100}
              onChange={event => setDraft(current => ({ ...current, categories: { ...current.categories, [category]: Math.max(0, Number(event.target.value) || 0) } }))} />
          </label>)}
        </div>}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{t('Supplier delay (days)')}</p>
          {data.suppliers.map(supplier => <label key={supplier.id} className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 text-sm">
            <span className="truncate">{supplier.name}</span>
            <input aria-label={t('Delay for {name}', { name: supplier.name })} inputMode="numeric" className={`${SCM_INPUT} text-right`} value={draft.delays[supplier.id] ?? 0}
              onChange={event => setDraft(current => ({ ...current, delays: { ...current.delays, [supplier.id]: Math.max(0, Math.min(365, Number(event.target.value) || 0)) } }))} />
          </label>)}
        </div>
        <label className={SCM_LABEL}><span>{t('Service level override (%)')}</span>
          <input inputMode="decimal" placeholder={String(Math.round(data.policy.serviceLevel * 1000) / 10)} className={SCM_INPUT} value={serviceText}
            onChange={event => {
              // Typed freely; applied only once it is a valid level.
              const text = event.target.value;
              setServiceText(text);
              const value = Number(text.trim());
              setDraft(current => ({ ...current, serviceLevel: text.trim() && value >= 50 && value <= 99.9 ? value : null }));
            }} />
        </label>
      </Section>
    </div>

    <div className="space-y-6">
      {!result ? <div className="space-y-2 rounded-lg bg-muted/40 p-6 text-center"><p className="text-sm font-medium">{t('Change an assumption to compare')}</p><p className="text-sm text-muted-foreground">{t('The comparison updates as you type: items newly at risk, revenue at risk, fill rate and spend.')}</p></div> : <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm"><span className="text-muted-foreground">{t('Scenario')}:</span> {describe()}</p>
          <Button size="sm" variant="ghost" onClick={() => askCopilot(t('In SCM, simulate this scenario: {scenario}. Which items break, when, and what should we do now to prepare? Use the planner, and separate what is calculated from what is assumed.', { scenario: describe() }))}><MessageSquare size={14} />{t('Discuss with AI')}</Button>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Kpi label={t('At risk')} value={`${result.delta.baseline.atRisk} → ${result.delta.scenario.atRisk}`} tone={result.delta.scenario.atRisk > result.delta.baseline.atRisk ? 'danger' : result.delta.scenario.atRisk < result.delta.baseline.atRisk ? 'success' : undefined} />
          <Kpi label={t('Revenue at risk')} value={money(result.delta.scenario.revenueAtRisk)} detail={t('was {n}', { n: money(result.delta.baseline.revenueAtRisk) })} tone={(result.delta.scenario.revenueAtRisk[currency] ?? 0) > (result.delta.baseline.revenueAtRisk[currency] ?? 0) ? 'danger' : undefined} />
          <Kpi label={t('Forecast fill rate')} value={fill(result.delta.scenario.fillRate)} detail={t('was {n}', { n: fill(result.delta.baseline.fillRate) })} />
          <Kpi label={t('Orders needed now')} value={money(result.delta.scenario.suggestedSpend)} detail={t('was {n}', { n: money(result.delta.baseline.suggestedSpend) })} />
        </div>
        <Section title={t('Newly at risk · {n}', { n: result.delta.newlyAtRisk.length })}>
          {result.delta.newlyAtRisk.length ? <ul className="divide-y divide-[var(--border-subtle)]">{result.delta.newlyAtRisk.map(entry => <li key={entry.key}>
            <button type="button" className={`${SCM_ROW} flex items-center gap-3 px-2 py-2`} onClick={() => openNode(entry.key)}>
              <span className="min-w-0 flex-1 truncate text-sm">{entry.name}</span>
              <span className="text-xs text-muted-foreground">{locationName(entry.locationId)}</span>
              <span className="text-xs tabular-nums text-[var(--status-danger)]">{entry.stockoutDay ? t('Runs out {day}', { day: formatDay(entry.stockoutDay, locale) }) : ''}</span>
            </button>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">{t('Nothing new breaks under this scenario.')}</p>}
        </Section>
        {result.delta.resolved.length > 0 && <Section title={t('No longer at risk · {n}', { n: result.delta.resolved.length })}>
          <ul className="flex flex-wrap gap-2">{result.delta.resolved.map(entry => <li key={entry.key}><Button size="xs" variant="ghost" onClick={() => openNode(entry.key)}>{entry.name} · {locationName(entry.locationId)}</Button></li>)}</ul>
        </Section>}
        <Section title={t('Orders this scenario would need')}>
          {result.plan.proposals.length ? <ul className="space-y-1 text-sm">{result.plan.proposals.map(proposal => <li key={proposal.key} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{proposal.supplierName} → {proposal.locationName}</span>
            <span className="text-xs text-muted-foreground">{t('{n} lines', { n: proposal.lines.length })}</span>
            <span className="tabular-nums">{formatMoney(proposal.total, proposal.currency, locale)}</span>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">{t('No orders needed.')}</p>}
        </Section>
      </>}
    </div>
  </div>;
}
