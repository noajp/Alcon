'use client';

import { useMemo } from 'react';
import { BarChart3, Building2, Columns3, Layers, List, Settings2, Sun, Users } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ToolSidebar, type ToolNavItem } from '@/Function/shared/tool/ToolSidebar';
import type { NavigationState } from '@/types/navigation';
import { useCrm } from '@/hooks/useCrm';
import { inList, todayQueue, type CrmList } from '@/Function/crm/crmModel';
import { crmRoute, routeTo, type CrmRoute } from '@/Function/crm/crmRoute';
import { useCrmScope } from './crmScope';

// The CRM sidebar, on the shared ToolSidebar: the scope (whose records), Today
// (my queue), the deals with their pipelines and saved lists, the forecast,
// the ledgers, and the settings at the foot. See ToolSidebar for the rules.

interface SidebarProps {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
}

// Lists that act on the deals: shown with their counts. The rest fold under "More".
const ACTION_LISTS: { id: CrmList; label: string }[] = [
  { id: 'at-risk', label: 'At risk' }, { id: 'renewing', label: 'Renewing' }, { id: 'no-next-step', label: 'No next step' }, { id: 'incomplete', label: 'Missing details' },
];
const OTHER_LISTS: { id: CrmList; label: string }[] = [
  { id: 'closing-soon', label: 'Closing soon' }, { id: 'stale', label: 'Going quiet' }, { id: 'mine', label: 'My deals' }, { id: 'won', label: 'Won' }, { id: 'lost', label: 'Lost' },
];

export function CrmSidebar({ navigation, onNavigate }: SidebarProps) {
  const { t } = useI18n();
  const route = crmRoute(navigation.crm);
  const crm = useCrm(route.pipelineId);
  const scoped = useCrmScope(crm, route.pipelineId);
  const go = (patch: Partial<CrmRoute>) => onNavigate({ crm: routeTo(route, { dealId: null, companyId: null, contactId: null, ...patch }) });
  const onRecord = !!(route.dealId || route.companyId || route.contactId);
  const pooled = scoped.pooled;

  // Today counts what needs me now: overdue and today's next steps.
  const mine = useMemo(() => pooled ? pooled.deals.filter(deal => !crm.me || !deal.ownerId || deal.ownerId === crm.me) : [], [pooled, crm.me]);
  const queue = useMemo(() => todayQueue(mine), [mine]);
  const due = queue.filter(deal => deal.action!.urgency === 'overdue' || deal.action!.urgency === 'today').length;
  const listCount = (list: CrmList) => pooled ? pooled.deals.filter(deal => inList(deal, list, pooled.today, pooled.params.horizonDays, crm.me)).length : 0;
  const listItem = (list: { id: CrmList; label: string }, counted: boolean): ToolNavItem => ({
    id: `list:${list.id}`, label: t(list.label), count: counted ? listCount(list.id) : null,
    active: !onRecord && route.view === 'deals' && route.list === list.id,
    onClick: () => go({ view: 'deals', list: list.id, pipelineId: null }),
  });

  const pipelineItems: ToolNavItem[] = scoped.pipelines.length > 1 ? scoped.pipelines.map(item => ({
    id: `pipeline:${item.id}`, label: item.name, icon: Columns3,
    active: !onRecord && route.view === 'board' && scoped.pipeline?.id === item.id,
    onClick: () => go({ view: 'board', pipelineId: item.id }),
  })) : [];

  return <ToolSidebar
    title={t('CRM')}
    scope={{
      value: scoped.scope, options: scoped.options, label: scoped.scopeName, icon: Layers,
      active: !onRecord && route.view === 'home',
      onOpen: () => go({ view: 'home' }),
      onChange: next => { scoped.setScope(next); go({ view: 'home', pipelineId: null }); },
    }}
    queue={[{
      id: 'today', label: t('Today'), icon: Sun, count: due, active: !onRecord && route.view === 'today', collapsed: true,
      onClick: () => go({ view: 'today' }),
      // The deals in my queue, nearest first — what Today holds.
      children: queue.slice(0, 6).map(deal => ({
        id: `today:${deal.id}`, label: deal.name, active: route.dealId === deal.id, title: t(deal.action!.message, deal.action!.values),
        onClick: () => onNavigate({ crm: routeTo(route, { view: 'today', dealId: deal.id, companyId: null, contactId: null }) }),
      })),
    }]}
    sections={[
      { id: 'work', items: [
        {
          id: 'deals', label: t('Deals'), icon: List,
          active: !onRecord && (route.view === 'deals' && !route.list || route.view === 'board' && scoped.pipelines.length <= 1),
          onClick: () => go({ view: scoped.pipelines.length <= 1 ? 'board' : 'deals', pipelineId: null }),
          children: [...pipelineItems, ...ACTION_LISTS.map(list => listItem(list, true))],
          more: OTHER_LISTS.map(list => listItem(list, false)),
        },
        { id: 'forecast', label: t('Forecast'), icon: BarChart3, active: !onRecord && route.view === 'forecast', onClick: () => go({ view: 'forecast' }) },
      ] },
      { id: 'records', label: t('Records'), items: [
        { id: 'companies', label: t('Companies'), icon: Building2, active: !onRecord && route.view === 'companies', onClick: () => go({ view: 'companies' }) },
        { id: 'contacts', label: t('Contacts'), icon: Users, active: !onRecord && route.view === 'contacts', onClick: () => go({ view: 'contacts' }) },
      ] },
    ]}
    footer={[{ id: 'settings', label: t('Pipeline settings'), icon: Settings2, active: !!route.settings, onClick: () => go({ settings: true }) }]}
  />;
}
