'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, PenLine, RefreshCw } from 'lucide-react';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { FONT } from '@/shared/designTokens';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MENU_ROW } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { forecastFor, inList, shiftDate, todayQueue, upcoming, type CrmDeal, type CrmUrgency, type CrmWorkspace } from './crmModel';
import { HealthDot, money, relativeDay } from './crmFormat';
import type { Crm } from '@/hooks/useCrm';

const GROUPS: { id: CrmUrgency; label: string }[] = [
  { id: 'overdue', label: 'Overdue' }, { id: 'today', label: 'Today' }, { id: 'soon', label: 'This week' }, { id: 'plan', label: 'Needs a plan' },
];

/** A key number: label, figure, one quiet line. Red only when it asks for action. */
export function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' }) {
  return <div className="min-w-0 space-y-0.5">
    <dt className={`${FONT.sm} truncate text-muted-foreground`}>{label}</dt>
    <dd className={`${FONT['2xl']} truncate tabular-nums ${tone === 'danger' ? 'text-[var(--status-danger)]' : 'text-foreground'}`}>{value}</dd>
    {hint && <dd className={`${FONT.sm} truncate text-muted-foreground`}>{hint}</dd>}
  </div>;
}

/** A won deal coming up for renewal: open its renewal deal in one step. */
export function StartRenewal({ deal, crm, onOpen, size = 'xs' }: { deal: CrmDeal; crm: Crm; onOpen: (dealId: string) => void; size?: 'xs' | 'sm' }) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setSaving(true); setError(null);
    try { await work(); }
    catch (cause) { setError(cause instanceof Error ? t(cause.message) : String(cause)); }
    finally { setSaving(false); }
  };
  const start = () => run(async () => onOpen((await crm.startRenewal(deal.id, t('{name} — renewal', { name: deal.name }))).id));
  const decline = () => run(() => crm.declineRenewal(deal.id, t('Won’t renew — the contract renewing on {date} ends.', { date: deal.renewsOn ?? '' })));
  return <span className="inline-flex flex-wrap items-center gap-1">
    <Button size={size} variant="secondary" disabled={saving} onClick={() => void start()}><RefreshCw size={12} />{t('Start renewal')}</Button>
    <Button size={size} variant="ghost" disabled={saving} onClick={() => void decline()}>{t('Won’t renew')}</Button>
    {error && <span role="alert" className="text-xs text-[var(--status-danger)]">{error}</span>}
  </span>;
}

function Snooze({ deal, crm }: { deal: CrmDeal; crm: Crm }) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  // Moving the date moves the Element when the next step is one.
  const move = async (days: number) => {
    setSaving(true);
    const due = shiftDate(crm.today, days);
    try { await (deal.nextStep ? crm.setNextStep(deal, { title: deal.nextStep, due }) : crm.saveDeal(deal.id, { nextStepOn: due })); } finally { setSaving(false); }
  };
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button size="xs" variant="ghost" disabled={saving}>{t('Reschedule')}<ChevronDown size={12} /></Button></DropdownMenuTrigger>
    <MenuShell as="dropdown" width="standard" align="end">
      {[[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week'], [14, 'In 2 weeks']].map(([days, label]) =>
        <DropdownMenuItem key={days} className={MENU_ROW} onSelect={() => void move(days as number).catch(() => {})}>{t(label as string)}</DropdownMenuItem>)}
    </MenuShell>
  </DropdownMenu>;
}

export function CrmToday({ crm, workspace, onOpen, onCapture, onList, pipelineDeals, onShowEveryone }: {
  crm: Crm; workspace: CrmWorkspace; onOpen: (dealId: string) => void; onCapture: () => void; onList: (list: 'at-risk' | 'closing-soon') => void;
  /** How many deals the pipeline has before Today narrows it to mine. */
  pipelineDeals: number; onShowEveryone?: () => void;
}) {
  const { t, locale } = useI18n();
  const { deals, today, params, primaryCurrency } = workspace;
  const queue = useMemo(() => todayQueue(deals), [deals]);
  const next = useMemo(() => upcoming(deals, today), [deals, today]);
  const forecast = useMemo(() => forecastFor(deals, primaryCurrency, today, 1), [deals, primaryCurrency, today]);
  const totals = workspace.totals.find(total => total.currency === primaryCurrency);
  const atRisk = deals.filter(deal => inList(deal, 'at-risk', today, params.horizonDays));
  const closing = deals.filter(deal => inList(deal, 'closing-soon', today, params.horizonDays));
  const overdue = queue.filter(deal => deal.action!.urgency === 'overdue').length;

  // "None of mine" is not "none at all": the onboarding is for an empty pipeline only.
  if (!deals.length && pipelineDeals > 0) return <div className="max-w-xl space-y-2 py-6">
    <p className={`${FONT.base} text-muted-foreground`}>{t('None of the deals in this pipeline are yours yet.')}</p>
    {onShowEveryone && <ButtonAppearanceProvider appearance="inline"><Button variant="ghost" size="sm" className="-ml-2.5" onClick={onShowEveryone}>{t('Show everyone’s deals')}</Button></ButtonAppearanceProvider>}
  </div>;

  if (!deals.length) return <div className="max-w-xl space-y-2 py-6">
    <p className={`${FONT.base} text-muted-foreground`}>{t('Start by capturing a deal you are working on. Paste the notes from your last call — Alcon fills in the account, amount, dates and next step for you to confirm.')}</p>
    <ButtonAppearanceProvider appearance="inline"><Button variant="ghost" size="sm" className="-ml-2.5" onClick={onCapture}><PenLine size={14} />{t('Capture a deal')}</Button></ButtonAppearanceProvider>
  </div>;

  return <div className="space-y-8">
    <dl className="grid grid-cols-2 gap-6 @2xl/crm:grid-cols-4">
      <Metric label={t('Forecast · next {n} days', { n: params.horizonDays })} value={totals ? money(totals.forecast, primaryCurrency, locale, true) : '—'} hint={t('Weighted by likelihood')} />
      <Metric label={t('Open pipeline')} value={totals ? money(totals.pipeline, primaryCurrency, locale, true) : '—'} hint={t('{n} open deals', { n: totals?.openCount ?? 0 })} />
      <Metric label={t('Won this month')} value={money(forecast.months[0]?.won ?? 0, primaryCurrency, locale, true)} hint={forecast.winRate !== null ? t('{p}% win rate', { p: Math.round(forecast.winRate * 100) }) : undefined} />
      <Metric label={t('Needs attention')} value={String(queue.length)} hint={overdue ? t('{n} overdue', { n: overdue }) : t('Nothing overdue')} tone={overdue ? 'danger' : undefined} />
    </dl>

    <div className="grid items-start gap-8 @4xl/crm:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
      <section aria-label={t('Next best actions')} className="min-w-0 space-y-5">
        <div className="space-y-0.5"><h2 className={`${FONT.lg} text-foreground`}>{t('Next best actions')}</h2>
          <p className={`${FONT.sm} text-muted-foreground`}>{t('Ranked by urgency, then by weighted value. Work from the top.')}</p></div>
        {!queue.length && <div className={`${FONT.base} space-y-0.5 text-muted-foreground`}><p>{t('You are clear for today')}</p><p>{t('Every open deal has a scheduled next step and recent contact, and no contract is up for renewal.')}</p></div>}
        {GROUPS.map(group => {
          const items = queue.filter(deal => deal.action!.urgency === group.id);
          if (!items.length) return null;
          return <div key={group.id} className="space-y-1">
            <h3 className={`${FONT.sm} font-medium ${group.id === 'overdue' ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>{t(group.label)} <span className="tabular-nums">{items.length}</span></h3>
            <ul className="-mx-2">{items.map(deal => <li key={deal.id} className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/40 has-[:focus-visible]:bg-muted/40">
              <HealthDot level={deal.health.level} />
              <button type="button" className="min-w-0 flex-1 text-left outline-none" onClick={() => onOpen(deal.id)}>
                <span className="flex items-baseline gap-2"><span className="truncate text-sm font-medium">{deal.name}</span><span className="truncate text-xs text-muted-foreground">{deal.account}</span></span>
                <span className="block truncate text-[13px] text-muted-foreground">{t(deal.action!.message, deal.action!.values)}</span>
              </button>
              <span className="hidden shrink-0 text-right text-xs tabular-nums @lg/crm:block">{money(deal.amount, deal.currency, locale, true)}<span className="block text-muted-foreground">{deal.probability ?? '—'}%</span></span>
              <ButtonAppearanceProvider appearance="inline"><div className="hidden shrink-0 gap-1 @xl/crm:flex">
                {deal.action!.code === 'renewal_due' ? <StartRenewal deal={deal} crm={crm} onOpen={onOpen} /> : <Snooze deal={deal} crm={crm} />}
              </div></ButtonAppearanceProvider>
            </li>)}</ul>
          </div>;
        })}
      </section>

      <aside className="min-w-0 space-y-8">
        <section className="space-y-1">
          <h2 className={`${FONT.lg} text-foreground`}>{t('Coming up')}</h2>
          {next.length ? <ul className="-mx-2">{next.map(deal => <li key={deal.id}>
            <button type="button" className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/40" onClick={() => onOpen(deal.id)}>
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{relativeDay(deal.nextActionDate, today, locale, t)}</span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px]">{deal.nextStep ?? deal.name}</span>{deal.nextStep && <span className="block truncate text-xs text-muted-foreground">{deal.name}</span>}</span>
            </button></li>)}</ul> : <p className="text-xs text-muted-foreground">{t('Nothing scheduled in the next 7 days.')}</p>}
        </section>
        <section className="space-y-1">
          <div className="flex items-center justify-between"><h2 className={`${FONT.lg} text-foreground`}>{t('Closing in the next {n} days', { n: params.horizonDays })}</h2>
            {closing.length > 0 && <ButtonAppearanceProvider appearance="inline"><Button size="xs" variant="ghost" onClick={() => onList('closing-soon')}>{t('All')}</Button></ButtonAppearanceProvider>}</div>
          {closing.length ? <ul className="-mx-2">{[...closing].sort((a, b) => a.closeDate!.localeCompare(b.closeDate!)).slice(0, 6).map(deal => <li key={deal.id}>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-muted/40" onClick={() => onOpen(deal.id)}>
              <HealthDot level={deal.health.level} /><span className="min-w-0 flex-1 truncate">{deal.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{money(deal.amount, deal.currency, locale, true)}</span>
            </button></li>)}</ul> : <p className="text-xs text-muted-foreground">{t('No open deals close in this period.')}</p>}
        </section>
        {atRisk.length > 0 && <section className="space-y-1">
          <div className="flex items-center justify-between"><h2 className={`${FONT.lg} text-foreground`}>{t('At risk')} <span className="tabular-nums text-[var(--status-danger)]">{atRisk.length}</span></h2>
            <ButtonAppearanceProvider appearance="inline"><Button size="xs" variant="ghost" onClick={() => onList('at-risk')}>{t('All')}</Button></ButtonAppearanceProvider></div>
          <p className="text-xs text-muted-foreground">{t('{amount} of pipeline needs rescuing.', { amount: money(atRisk.filter(deal => deal.currency === primaryCurrency).reduce((sum, deal) => sum + (deal.amount ?? 0), 0), primaryCurrency, locale, true) })}</p>
        </section>}
      </aside>
    </div>
  </div>;
}
