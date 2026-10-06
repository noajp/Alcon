'use client';

import { useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronRight, Layers, Search, Sun, Users } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SidebarRow, SidebarRowAction, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import type { NavigationState } from '@/types/navigation';
import { useCrm, type Crm } from '@/hooks/useCrm';
import { todayQueue } from './crmModel';
import { crmRoute, routeTo, type CrmRoute } from './crmRoute';
import { HealthDot } from './crmFormat';

// The CRM sidebar is the App's tree, the way Execution's is Domains: the
// containers you can be in. Today (my queue, unfolding to the deals in it),
// then each pipeline, then the records shared across pipelines — Companies
// and Contacts. What narrows a pipeline (a stage, a list) is a filter on its
// Deals and Board, not a place in the tree.

interface SidebarProps {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}

export function CrmSidebar(props: SidebarProps) {
  const crm = useCrm(crmRoute(props.navigation.crm).pipelineId);
  return <CrmSidebarTree crm={crm} {...props} />;
}

/** Pipelines grouped by the Domain they belong to; Space-wide ones first. */
function pipelineGroups(crm: Crm) {
  const groups = new Map<string | null, { id: string | null; name: string | null; pipelines: Crm['pipelines'] }>();
  for (const pipeline of crm.pipelines) {
    const id = pipeline.domain_id ?? null;
    if (!groups.has(id)) groups.set(id, { id, name: id ? crm.domains.find(domain => domain.id === id)?.name ?? null : null, pipelines: [] });
    groups.get(id)!.pipelines.push(pipeline);
  }
  return [...groups.values()].sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : (a.name ?? '').localeCompare(b.name ?? '')));
}

const SHARED_VIEWS = ['today', 'companies', 'contacts'];

function CrmSidebarTree({ crm, navigation, onNavigate }: SidebarProps & { crm: Crm }) {
  const { t } = useI18n();
  const route = crmRoute(navigation.crm);
  const go = (patch: Partial<CrmRoute>) => onNavigate({ crm: routeTo(route, { dealId: null, companyId: null, contactId: null, ...patch }) });
  const workspace = crm.workspace;
  const [todayOpen, setTodayOpen] = useState(true);
  // My queue: deals that need me today, soonest first — the same list the
  // Today page works from.
  const queue = useMemo(() => workspace ? todayQueue(workspace.deals.filter(deal => !crm.me || !deal.ownerId || deal.ownerId === crm.me)) : [], [workspace, crm.me]);
  const overdue = queue.filter(deal => deal.action!.urgency === 'overdue').length;
  const onRecord = !!(route.dealId || route.companyId || route.contactId);
  const groups = pipelineGroups(crm);

  return <div className="mt-1 pb-4">
    <SidebarSectionLabel>{t('CRM')}</SidebarSectionLabel>
    <div className="mt-1">
      <label className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-muted-foreground focus-within:bg-sidebar-accent hover:bg-sidebar-accent/50">
        <Search size={16} className="shrink-0" />
        <input type="search" aria-label={t('Search CRM')} placeholder={t('Search CRM')} disabled={!workspace}
          value={route.query ?? ''} onChange={event => go({ query: event.target.value, view: event.target.value && !['deals', 'board', 'companies', 'contacts'].includes(route.view) ? 'deals' : route.view })}
          className="h-full min-w-0 flex-1 bg-transparent text-xs font-semibold text-foreground outline-none placeholder:text-muted-foreground" />
      </label>
    </div>

    {/* Today unfolds to the deals in my queue, the way a Domain unfolds to
        its Objects: the row is the page, the children are what it holds. */}
    <div className="mt-2">
      <SidebarRow active={route.view === 'today' && !onRecord} icon={<Sun size={16} />} label={t('Today')}
        meta={queue.length ? <span className={overdue ? 'text-[var(--status-danger)]' : undefined}>{queue.length}</span> : null}
        onClick={() => go({ view: 'today' })}
        actions={<SidebarRowAction label={`${t(todayOpen ? 'Collapse' : 'Expand')} ${t('Today')}`} aria-expanded={todayOpen} onClick={() => setTodayOpen(v => !v)}>
          {todayOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </SidebarRowAction>} />
      {todayOpen && queue.length > 0 && <div className="mt-0.5 pl-7">
        {queue.slice(0, 8).map(deal => <SidebarRow key={deal.id} size="sm" active={route.dealId === deal.id} icon={<HealthDot level={deal.health.level} />}
          label={deal.name} title={`${deal.name} — ${t(deal.action!.message, deal.action!.values)}`}
          onClick={() => onNavigate({ crm: routeTo(route, { view: 'today', dealId: deal.id, companyId: null, contactId: null }) })} />)}
        {queue.length > 8 && <SidebarRow size="sm" label={<span className="text-muted-foreground">{t('{n} more', { n: queue.length - 8 })}</span>} onClick={() => go({ view: 'today' })} />}
      </div>}
    </div>

    <SidebarSectionLabel className="mt-4">{t('Pipelines')}</SidebarSectionLabel>
    <div className="mt-1 space-y-px">{groups.map(group => <div key={group.id ?? 'space'}>
      {groups.length > 1 && <p className="truncate px-2.5 pb-0.5 pt-1.5 text-[11px] text-muted-foreground/60">{group.name ?? t('Whole Space')}</p>}
      {group.pipelines.map(item => {
        const current = item.id === crm.pipeline?.id;
        const active = current && !onRecord && !SHARED_VIEWS.includes(route.view);
        const open = crm.allDeals.filter(deal => deal.pipeline_id === item.id && !['won', 'lost'].includes(deal.stage.toLowerCase())).length;
        return <SidebarRow key={item.id} active={active} icon={<Layers size={16} />} label={item.name} meta={open || null}
          onClick={() => go({ pipelineId: item.id, view: current && !SHARED_VIEWS.includes(route.view) ? route.view : 'overview' })} />;
      })}
    </div>)}</div>

    <SidebarSectionLabel className="mt-4">{t('Records')}</SidebarSectionLabel>
    <div className="mt-1 space-y-px">
      <SidebarRow active={route.view === 'companies' && !onRecord} icon={<Building2 size={16} />} label={t('Companies')} meta={crm.companies.length || null} onClick={() => go({ view: 'companies' })} />
      <SidebarRow active={route.view === 'contacts' && !onRecord} icon={<Users size={16} />} label={t('Contacts')} meta={crm.contacts.length || null} onClick={() => go({ view: 'contacts' })} />
    </div>
  </div>;
}
