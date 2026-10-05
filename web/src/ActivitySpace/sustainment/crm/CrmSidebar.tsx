'use client';

import { useMemo } from 'react';
import { BarChart3, Building2, Columns3, List, PenLine, Search, Settings2, Sun, Users } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import type { NavigationState } from '@/types/navigation';
import { useCrm, type Crm } from '@/hooks/useCrm';
import { inList, pipelineColumns, todayQueue, type CrmList } from './crmModel';
import { crmRoute, routeTo, type CrmRoute, type CrmViewId } from './crmRoute';
import { HealthDot, money } from './crmFormat';

const LISTS: { id: CrmList; label: string }[] = [
  { id: 'mine', label: 'My deals' },
  { id: 'at-risk', label: 'At risk' },
  { id: 'closing-soon', label: 'Closing soon' },
  { id: 'no-next-step', label: 'No next step' },
  { id: 'stale', label: 'Going quiet' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'incomplete', label: 'Missing details' },
];

function Section({ label }: { label: string }) {
  return <SidebarSectionLabel className="mt-4">{label}</SidebarSectionLabel>;
}

/** Pipelines under the Domain they belong to; Space-wide ones last. */
function pipelineGroups(crm: Crm) {
  const groups = new Map<string | null, { id: string | null; name: string | null; pipelines: Crm['pipelines'][number][] }>();
  for (const pipeline of crm.pipelines) {
    const id = pipeline.domain_id ?? null;
    const group = groups.get(id) ?? { id, name: id ? crm.domains.find(domain => domain.id === id)?.name ?? null : null, pipelines: [] };
    group.pipelines.push(pipeline);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || (a.name ?? '').localeCompare(b.name ?? ''));
}

interface SidebarProps {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}

export function CrmSidebar(props: SidebarProps) {
  const crm = useCrm(crmRoute(props.navigation.crm).pipelineId);
  return <CrmSidebarList crm={crm} {...props} />;
}

/** CRM navigation: capture and search first, then views, stages and lists —
 * each with the count that tells you whether it is worth opening. */
function CrmSidebarList({ crm, navigation, onNavigate }: SidebarProps & { crm: Crm }) {
  const { t, locale } = useI18n();
  const route = crmRoute(navigation.crm);
  const go = (patch: Partial<CrmRoute>) => onNavigate({ crm: routeTo(route, { dealId: null, companyId: null, contactId: null, ...patch }) });
  const workspace = crm.workspace;
  const recordLabel = crm.pipeline?.record_label;
  const summary = useMemo(() => {
    if (!workspace) return null;
    const { deals, today, params, primaryCurrency } = workspace;
    const queue = todayQueue(deals.filter(deal => !crm.me || !deal.ownerId || deal.ownerId === crm.me));
    return {
      today: queue.length,
      overdue: queue.filter(deal => deal.action!.urgency === 'overdue').length,
      open: deals.filter(deal => deal.outcome === 'open').length,
      deals: deals.length,
      weighted: workspace.totals.find(total => total.currency === primaryCurrency)?.weightedPipeline ?? null,
      primaryCurrency,
      stages: pipelineColumns(workspace).filter(column => !column.closed),
      lists: Object.fromEntries(LISTS.map(list => [list.id, deals.filter(deal => inList(deal, list.id, today, params.horizonDays, crm.me)).length])) as Record<CrmList, number>,
    };
  }, [workspace, crm.me]);

  const views: { id: CrmViewId; label: string; icon: typeof Sun; count?: React.ReactNode }[] = [
    { id: 'today', label: 'Today', icon: Sun, count: summary?.today ? <span className={summary.overdue ? 'text-[var(--status-danger)]' : undefined}>{summary.today}</span> : null },
    { id: 'pipeline', label: 'Pipeline', icon: Columns3, count: summary?.open },
    { id: 'deals', label: recordLabel ?? 'Deals', icon: List, count: summary?.deals },
    { id: 'companies', label: 'Companies', icon: Building2, count: crm.companies.length || null },
    { id: 'contacts', label: 'Contacts', icon: Users, count: crm.contacts.length || null },
    { id: 'forecast', label: 'Forecast', icon: BarChart3, count: summary?.weighted && summary.primaryCurrency ? money(summary.weighted, summary.primaryCurrency, locale, true) : null },
  ];
  const filtered = route.view === 'deals' || route.view === 'pipeline';

  return <div className="mt-1 pb-4">
    <SidebarSectionLabel>{t('CRM')}</SidebarSectionLabel>
    <div className="mt-1 space-y-1">
      {/* Capture is the one verb in a list of places: its name stays in the
          foreground so it reads as the entry point. */}
      <SidebarRow icon={<PenLine size={16} className="text-foreground" />} label={<span className="text-foreground">{t('Capture')}</span>}
        meta={t('Notes, email, a line')} disabled={!workspace} onClick={() => go({ capture: true })} />
      <label className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground focus-within:bg-sidebar-accent hover:bg-sidebar-accent/50">
        <Search size={16} className="shrink-0" />
        <input type="search" aria-label={t('Search CRM')} placeholder={t('Search CRM')} disabled={!workspace}
          value={route.query ?? ''} onChange={event => onNavigate({ crm: { ...route, query: event.target.value, view: event.target.value && !['deals', 'pipeline', 'companies', 'contacts'].includes(route.view) ? 'deals' : route.view } })}
          className="h-full min-w-0 flex-1 bg-transparent text-xs font-semibold text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
    </div>

    {crm.pipelines.length > 1 && <>
      <Section label={t('Pipelines')} />
      <div className="space-y-px">{pipelineGroups(crm).map(group => <div key={group.id ?? 'space'}>
        {pipelineGroups(crm).length > 1 && <p className="truncate px-2.5 pb-0.5 pt-1.5 text-[11px] text-muted-foreground/60">{group.name ?? t('Whole Space')}</p>}
        {group.pipelines.map(item => {
          const active = item.id === crm.pipeline?.id;
          return <SidebarRow key={item.id} active={active} buttonProps={{ 'aria-current': active ? 'true' : undefined }} label={item.name}
            meta={crm.allDeals.filter(deal => deal.pipeline_id === item.id && !['won', 'lost'].includes(deal.stage.toLowerCase())).length}
            onClick={() => go({ pipelineId: item.id })} />;
        })}
      </div>)}</div>
    </>}

    <div className="mt-3 space-y-px">
      {views.map(({ id, label, icon: Icon, count }) => {
        const active = route.view === id && !(id === 'deals' && (route.stage !== null && route.stage !== undefined || route.list || route.account));
        return <SidebarRow key={id} active={active} icon={<Icon size={16} />} label={t(label)} meta={count}
          disabled={!workspace && id !== 'settings'} onClick={() => go({ view: id, stage: null, list: null, account: null })} />;
      })}
    </div>

    {summary && summary.stages.length > 0 && <>
      <Section label={t('Stages')} />
      <div className="space-y-px">
        {summary.stages.map(column => {
          const active = filtered && route.stage === column.stage.id;
          const amount = summary.primaryCurrency ? column.totals[summary.primaryCurrency] : undefined;
          return <SidebarRow key={column.stage.id} active={active} icon={<span className="text-[11px] tabular-nums">{column.deals.length}</span>}
            label={t(column.stage.label)} meta={amount ? money(amount, summary.primaryCurrency, locale, true) : null}
            onClick={() => go({ view: 'deals', stage: column.stage.id, list: null, account: null })} />;
        })}
      </div>
    </>}

    {summary && <>
      <Section label={t('Lists')} />
      <div className="space-y-px">
        {LISTS.filter(list => (list.id !== 'incomplete' || summary.lists.incomplete > 0) && (list.id !== 'mine' || crm.me)).map(list => {
          const active = filtered && route.list === list.id;
          const count = summary.lists[list.id];
          return <SidebarRow key={list.id} active={active}
            icon={list.id === 'at-risk' ? <HealthDot level="risk" /> : list.id === 'incomplete' ? <HealthDot level="watch" /> : <span className="size-1.5 rounded-full bg-current opacity-40" />}
            label={t(list.label)} meta={<span className={count ? undefined : 'opacity-40'}>{count}</span>}
            onClick={() => go({ view: 'deals', list: list.id, stage: null, account: null })} />;
        })}
      </div>
    </>}

    <div className="mt-4 space-y-px">
      <SidebarRow active={route.view === 'settings'} icon={<Settings2 size={16} />} label={t('Pipeline settings')} onClick={() => go({ view: 'settings' })} />
    </div>
  </div>;
}
