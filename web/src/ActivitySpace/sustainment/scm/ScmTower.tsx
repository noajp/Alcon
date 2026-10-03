'use client';

import { useMemo } from 'react';
import { ArrowRight, Bot, MessageSquare } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { countHealth, summarizeNodes, type ScmHealth } from './scmEngine';
import { briefingText, daysFrom, formatDay, formatMoney, formatMoneyShort, formatQuantity, HEALTH_LABEL, HEALTH_TONE } from './scmText';
import { Dot, Kpi, Meter, Pill, Section, SCM_ROW, TONE_FILL } from './ScmParts';
import { useScmSurface } from './scmSurface';

const HEALTH_ORDER: ScmHealth[] = ['stockout', 'critical', 'reorder', 'healthy', 'excess', 'dead', 'no_demand'];

/** The morning view: what is at risk, what the plan proposes, and how the autopilot stands. */
export function ScmTower({ onRunPlanner, running }: { onRunPlanner: () => void; running: boolean }) {
  const { t, locale } = useI18n();
  const { data, plan, nodes, go, openNode, askCopilot, locationName, locationId } = useScmSurface();
  const totals = useMemo(() => summarizeNodes(nodes), [nodes]);
  const counts = useMemo(() => countHealth(nodes), [nodes]);
  const keys = useMemo(() => new Set(nodes.map(node => node.key)), [nodes]);
  const briefing = plan.briefing.filter(line => !line.nodeKeys.length || line.nodeKeys.some(key => keys.has(key)));
  const primary = totals.find(total => total.currency === data.policy.currency) ?? totals[0];
  const atRisk = counts.stockout + counts.critical;
  const upcoming = nodes.filter(node => node.stockoutDay && (node.health === 'critical' || node.health === 'stockout' || node.health === 'reorder'))
    .sort((a, b) => (a.stockoutDay ?? '').localeCompare(b.stockoutDay ?? '')).slice(0, 8);
  const proposals = plan.proposals.filter(proposal => !locationId || proposal.locationId === locationId);
  const budget = data.policy.monthlyBudget;
  const lastRun = data.runs[0];
  const watch = plan.suppliers.filter(supplier => supplier.score !== null).slice(0, 4);

  return <div className="space-y-8">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Kpi label={t('At risk now')} value={atRisk} tone={atRisk ? 'danger' : 'success'} detail={t('{stockout} out · {critical} before supply', { stockout: counts.stockout, critical: counts.critical })} />
      <Kpi label={t('Revenue at risk')} value={primary ? formatMoneyShort(primary.revenueAtRisk, primary.currency, locale) : '—'} tone={primary?.revenueAtRisk ? 'danger' : undefined} detail={t('Even with every order placed on time')} />
      <Kpi label={t('Forecast fill rate')} value={primary?.fillRate === null || !primary ? '—' : `${(primary.fillRate * 100).toFixed(1)}%`} tone={primary && primary.fillRate !== null && primary.fillRate < data.policy.serviceLevel ? 'warning' : undefined} detail={t('Target {n}%', { n: Math.round(data.policy.serviceLevel * 1000) / 10 })} />
      <Kpi label={t('Inventory value')} value={primary ? formatMoneyShort(primary.inventoryValue, primary.currency, locale) : '—'} detail={primary?.turns ? t('{n} turns a year', { n: primary.turns.toFixed(1) }) : undefined} />
      <Kpi label={t('Proposed spend')} value={primary ? formatMoneyShort(primary.suggestedSpend, primary.currency, locale) : '—'} detail={t('{n} orders', { n: proposals.length })} />
      <Kpi label={t('Excess & dead stock')} value={primary ? formatMoneyShort(primary.excessValue, primary.currency, locale) : '—'} tone={primary?.excessValue ? 'info' : undefined} detail={t('{n} items', { n: counts.excess + counts.dead })} />
    </div>

    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-8">
        <Section title={t('Briefing')} description={t('As of {day}{location}', { day: formatDay(plan.today, locale), location: locationId ? ` · ${locationName(locationId)}` : '' })}
          action={<Button variant="ghost" size="sm" onClick={() => askCopilot(t('Walk me through today\'s SCM briefing{location}. Rank what to do first and why, with the numbers behind each step.', { location: locationId ? ` (${locationName(locationId)})` : '' }))}><MessageSquare size={14} />{t('Discuss with AI')}</Button>}>
          <ul className="space-y-1">
            {briefing.map((line, index) => <li key={index}>
              <button type="button" className={`${SCM_ROW} flex items-start gap-3 px-2 py-2`} onClick={() => {
                if (line.kind === 'proposals') go('replenish');
                else if (line.kind === 'overdue') go('orders');
                else if (line.kind === 'supplier') go('suppliers');
                else if (line.nodeKeys.length === 1) openNode(line.nodeKeys[0]);
                else if (line.kind === 'excess') go('inventory', { scmHealth: 'excess' });
                else go('exceptions');
              }}>
                <span className="mt-1.5"><Dot tone={line.severity === 'high' ? 'danger' : line.severity === 'medium' ? 'warning' : 'success'} /></span>
                <span className="min-w-0 flex-1 text-sm leading-relaxed">{briefingText(line, t, locale)}</span>
                <ArrowRight size={14} className="mt-1 shrink-0 text-muted-foreground" />
              </button>
            </li>)}
            {!briefing.length && <li className="px-2 py-2 text-sm text-muted-foreground">{t('Nothing to report at this location.')}</li>}
          </ul>
        </Section>

        <Section title={t('Running out soon')} description={t('Projected with the orders already placed.')}
          action={<Button variant="ghost" size="sm" onClick={() => go('exceptions')}>{t('All exceptions')}</Button>}>
          {upcoming.length ? <ul className="divide-y divide-[var(--border-subtle)]">
            {upcoming.map(node => {
              const days = daysFrom(plan.today, node.stockoutDay!);
              const lead = daysFrom(plan.today, node.earliestNewSupply);
              return <li key={node.key}>
                <button type="button" className={`${SCM_ROW} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-2 py-2.5 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]`} onClick={() => openNode(node.key)}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{node.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{node.sku} · {locationName(node.locationId)}</span>
                  </span>
                  <span className="hidden sm:block">
                    <span className="relative block h-1.5 rounded-full bg-muted">
                      <span className={`absolute inset-y-0 left-0 rounded-full ${TONE_FILL[days < lead ? 'danger' : 'warning']}`} style={{ width: `${Math.min(100, (days / Math.max(lead, days, 1)) * 100)}%` }} />
                      <span className="absolute -top-0.5 h-2.5 w-px bg-foreground/60" style={{ left: `${Math.min(100, (lead / Math.max(lead, days, 1)) * 100)}%` }} title={t('Earliest new supply')} />
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">{t('Supply can arrive in {n} days', { n: lead })}</span>
                  </span>
                  <span className="text-right">
                    <span className={`block text-sm font-semibold tabular-nums ${days < lead ? 'text-[var(--status-danger)]' : ''}`}>{days <= 0 ? t('Today') : days === 1 ? t('Tomorrow') : t('{n} days', { n: days })}</span>
                    <span className="block text-[11px] text-muted-foreground">{formatDay(node.stockoutDay, locale)}</span>
                  </span>
                </button>
              </li>;
            })}
          </ul> : <p className="px-2 text-sm text-muted-foreground">{t('No item is projected to run out before its next order can arrive.')}</p>}
        </Section>
      </div>

      <aside className="min-w-0 space-y-8">
        <Section title={t('Stock health')} description={t('{n} item-locations', { n: nodes.length })}>
          <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={HEALTH_ORDER.map(health => `${t(HEALTH_LABEL[health])} ${counts[health]}`).join(', ')}>
            {HEALTH_ORDER.map(health => counts[health] ? <span key={health} className={TONE_FILL[HEALTH_TONE[health]]} style={{ width: `${(counts[health] / Math.max(1, nodes.length)) * 100}%` }} /> : null)}
          </div>
          <ul className="grid grid-cols-2 gap-1">
            {HEALTH_ORDER.filter(health => counts[health]).map(health => <li key={health}>
              <button type="button" className={`${SCM_ROW} flex items-center gap-2 px-2 py-1.5 text-xs`} onClick={() => go('inventory', { scmHealth: health })}>
                <Dot tone={HEALTH_TONE[health]} /><span className="flex-1 truncate">{t(HEALTH_LABEL[health])}</span><span className="tabular-nums text-muted-foreground">{counts[health]}</span>
              </button>
            </li>)}
          </ul>
        </Section>

        <Section title={t('Autopilot')} description={data.policy.autopilotEnabled ? t('Orders within {limit} are approved automatically; larger ones become approval Elements.', { limit: formatMoney(data.policy.autoApproveLimit, data.policy.currency, locale) }) : t('Off. The planner proposes; people place every order.')}
          action={<Pill tone={data.policy.autopilotEnabled ? 'success' : 'muted'}>{data.policy.autopilotEnabled ? t('On') : t('Off')}</Pill>}>
          {budget !== null && <div className="space-y-1.5">
            <div className="flex justify-between text-xs"><span className="text-muted-foreground">{t('Committed this month')}</span><span className="tabular-nums">{formatMoney(plan.committedThisMonth, data.policy.currency, locale)} / {formatMoney(budget, data.policy.currency, locale)}</span></div>
            <Meter value={budget > 0 ? plan.committedThisMonth / budget : 1} tone={plan.committedThisMonth > budget ? 'danger' : plan.committedThisMonth > budget * 0.8 ? 'warning' : 'info'} label={t('Committed this month')} />
          </div>}
          <p className="text-xs text-muted-foreground">{lastRun ? t('Last run {when}: {n} orders created.', { when: new Date(lastRun.ranAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }), n: lastRun.summary.created?.length ?? 0 }) : t('Not run yet.')}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={running || !plan.proposals.length} onClick={onRunPlanner}><Bot size={14} />{running ? t('Planning…') : t('Run planner now')}</Button>
            <Button variant="ghost" size="sm" onClick={() => go('settings')}>{t('Policy')}</Button>
          </div>
        </Section>

        <Section title={t('Supplier watch')} action={<Button variant="ghost" size="sm" onClick={() => go('suppliers')}>{t('All suppliers')}</Button>}>
          {watch.length ? <ul className="space-y-1">{watch.map(supplier => <li key={supplier.supplierId} className="flex items-center gap-3 px-2 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{supplier.name}</span>
              <span className="block text-[11px] text-muted-foreground">{t('On time {n}%', { n: Math.round((supplier.onTimeRate ?? 0) * 100) })} · {t('avg {n} days late', { n: formatQuantity(Math.max(0, supplier.averageDelay ?? 0), locale) })}{supplier.overdueOrders ? ` · ${t('{n} overdue', { n: supplier.overdueOrders })}` : ''}</span>
            </span>
            <Pill tone={(supplier.score ?? 0) >= 85 ? 'success' : (supplier.score ?? 0) >= 65 ? 'warning' : 'danger'}>{supplier.score}</Pill>
          </li>)}</ul> : <p className="px-2 text-sm text-muted-foreground">{t('Scores appear once orders have been received.')}</p>}
        </Section>
      </aside>
    </div>
  </div>;
}
