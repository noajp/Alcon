'use client';

import { useMemo } from 'react';
import { BarChart3, Building2, Columns3, List, PenLine, Search, Settings2, Sun } from 'lucide-react';
import { Button } from '@/ui/button';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { NavigationState } from '@/types/navigation';
import { accountsOf, inList, pipelineColumns, todayQueue, type CrmList } from './crmModel';
import { crmRoute, routeTo, type CrmRoute, type CrmViewId } from './crmRoute';
import { HealthDot, money } from './crmFormat';
import { useCrm, type Crm } from './useCrm';

const VIEWS: { id: CrmViewId; label: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'pipeline', label: 'Pipeline', icon: Columns3 },
  { id: 'deals', label: 'Deals', icon: List },
  { id: 'accounts', label: 'Accounts', icon: Building2 },
  { id: 'forecast', label: 'Forecast', icon: BarChart3 },
];

const LISTS: { id: CrmList; label: string }[] = [
  { id: 'at-risk', label: 'At risk' },
  { id: 'closing-soon', label: 'Closing soon' },
  { id: 'no-next-step', label: 'No next step' },
  { id: 'stale', label: 'Going quiet' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'incomplete', label: 'Missing details' },
];

const ROW = 'w-full gap-2.5 text-xs font-semibold';
const rowState = (active: boolean) => active ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:text-foreground';

function Section({ label }: { label: string }) {
  return <div className="mt-4 flex h-6 items-center px-2 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{label}</div>;
}

/** CRM navigation: capture and search first, then views, stages and lists —
 * each with the count that tells you whether it is worth opening. */
interface SidebarProps {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}

export function CrmSidebar(props: SidebarProps) {
  const crm = useCrm();
  return <CrmSidebarList crm={crm} {...props} />;
}

function CrmSidebarList({ crm, navigation, onNavigate }: SidebarProps & { crm: Crm }) {
  const { t, locale } = useI18n();
  const route = crmRoute(navigation.crm);
  const go = (patch: Partial<CrmRoute>) => onNavigate({ crm: routeTo(route, { dealId: null, ...patch }) });
  const workspace = crm.workspace;
  const summary = useMemo(() => {
    if (!workspace) return null;
    const { deals, today, params, primaryCurrency } = workspace;
    const queue = todayQueue(deals);
    return {
      today: queue.length,
      overdue: queue.filter(deal => deal.action!.urgency === 'overdue').length,
      open: deals.filter(deal => deal.outcome === 'open' && deal.valid).length,
      deals: deals.length,
      accounts: accountsOf(deals).filter(account => account.key).length,
      forecast: workspace.analysis.totals.find(total => total.currency === primaryCurrency)?.weightedPipeline ?? null,
      primaryCurrency,
      stages: pipelineColumns(workspace).filter(column => !column.closed),
      lists: Object.fromEntries(LISTS.map(list => [list.id, deals.filter(deal => inList(deal, list.id, today, params.horizonDays)).length])) as Record<CrmList, number>,
    };
  }, [workspace]);

  const counts: Partial<Record<CrmViewId, React.ReactNode>> = summary ? {
    today: summary.today ? <span className={summary.overdue ? 'text-[var(--status-danger)]' : undefined}>{summary.today}</span> : null,
    pipeline: summary.open, deals: summary.deals, accounts: summary.accounts,
    forecast: summary.forecast !== null && summary.primaryCurrency ? money(summary.forecast, summary.primaryCurrency, locale, true) : null,
  } : {};
  const filtered = route.view === 'deals' || route.view === 'pipeline';

  return <div className="mt-1 pb-4">
    <div className="mt-3 flex h-6 items-center px-2 text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('CRM')}</div>
    <div className="mt-1 space-y-1">
      <Button variant="ghost" align="start" className={`${ROW} text-foreground`} disabled={!workspace} onClick={() => go({ capture: true })}>
        <PenLine size={16} />{t('Capture')}<span className="ml-auto text-[11px] font-normal text-muted-foreground/70">{t('Notes, email, a line')}</span>
      </Button>
      <label className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground focus-within:bg-sidebar-accent hover:bg-sidebar-accent/50">
        <Search size={16} className="shrink-0" />
        <input type="search" aria-label={t('Search deals')} placeholder={t('Search deals')} disabled={!workspace}
          value={route.query ?? ''} onChange={event => onNavigate({ crm: { ...route, query: event.target.value, view: event.target.value && !filtered ? 'deals' : route.view } })}
          className="h-full min-w-0 flex-1 bg-transparent text-xs font-semibold text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
    </div>

    <div className="mt-3 space-y-px">
      {VIEWS.map(({ id, label, icon: Icon }) => {
        const active = route.view === id && !(id === 'deals' && (route.stage || route.list || route.account));
        return <Button key={id} variant="ghost" align="start" className={`${ROW} ${rowState(active)}`} aria-current={active ? 'page' : undefined}
          disabled={!workspace && id !== 'today'} onClick={() => go({ view: id, stage: null, list: null, account: null })}>
          <Icon size={16} />{t(label)}<span className="ml-auto text-[11px] font-normal tabular-nums text-muted-foreground/70">{counts[id]}</span>
        </Button>;
      })}
    </div>

    {summary && summary.stages.length > 0 && <>
      <Section label={t('Stages')} />
      <div className="space-y-px">
        {summary.stages.map(column => {
          const active = filtered && route.stage === column.stage.id;
          const amount = summary.primaryCurrency ? column.totals[summary.primaryCurrency] : undefined;
          return <Button key={column.stage.id || 'none'} variant="ghost" align="start" className={`${ROW} ${rowState(active)}`} aria-current={active ? 'page' : undefined}
            onClick={() => go({ view: 'deals', stage: column.stage.id, list: null, account: null })}>
            <span className="w-4 text-center text-[11px] tabular-nums">{column.deals.length}</span>
            <span className="min-w-0 flex-1 truncate text-left">{column.stage.id ? t(column.stage.label) : t('No stage')}</span>
            {amount ? <span className="text-[11px] font-normal tabular-nums text-muted-foreground/70">{money(amount, summary.primaryCurrency, locale, true)}</span> : null}
          </Button>;
        })}
      </div>
    </>}

    {summary && <>
      <Section label={t('Lists')} />
      <div className="space-y-px">
        {LISTS.filter(list => list.id !== 'incomplete' || summary.lists.incomplete > 0).map(list => {
          const active = filtered && route.list === list.id;
          const count = summary.lists[list.id];
          return <Button key={list.id} variant="ghost" align="start" className={`${ROW} ${rowState(active)}`} aria-current={active ? 'page' : undefined}
            onClick={() => go({ view: 'deals', list: list.id, stage: null, account: null })}>
            <span className="flex w-4 justify-center">{list.id === 'at-risk' ? <HealthDot level="risk" /> : list.id === 'incomplete' ? <HealthDot level="watch" /> : <span className="size-1.5 rounded-full bg-current opacity-40" />}</span>
            <span className="min-w-0 flex-1 truncate text-left">{t(list.label)}</span>
            <span className={`text-[11px] font-normal tabular-nums ${count ? 'text-muted-foreground/70' : 'text-muted-foreground/30'}`}>{count}</span>
          </Button>;
        })}
      </div>
    </>}

    <div className="mt-4 space-y-px">
      <Button variant="ghost" align="start" className={`${ROW} ${rowState(route.view === 'settings')}`} aria-current={route.view === 'settings' ? 'page' : undefined} onClick={() => go({ view: 'settings' })}>
        <Settings2 size={16} />{workspace ? t('Pipeline settings') : t('Set up pipeline')}
      </Button>
    </div>
  </div>;
}
