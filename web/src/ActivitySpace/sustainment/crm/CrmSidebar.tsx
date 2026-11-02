'use client';

import { useMemo, type ReactNode } from 'react';
import { Building2, Layers, List, Settings2, Sun } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ToolSidebar, type ToolNavItem } from '@/Function/shared/tool/ToolSidebar';
import { GroupTree } from '@/Function/shared/folders/GroupTree';
import { SPACE_SCOPE, type ToolScope } from '@/Function/shared/tool/toolScope';
import type { SidebarDomain } from '@/ActivitySpace/sustainment/files/FilesSidebar';
import type { NavigationState } from '@/types/navigation';
import { useCrm } from '@/hooks/useCrm';
import { inList, todayQueue, type CrmList } from '@/Function/crm/crmModel';
import { crmRoute, routeTo, type CrmRoute } from '@/Function/crm/crmRoute';
import { useCrmScope } from './crmScope';

// The CRM sidebar, on the shared ToolSidebar, laid out as Files and Table
// are: everything in the Space, Today (my queue), the lists and the
// settings first, then each Domain unfolding onto its Companies (each
// opening onto its deals) and its Deals. See ToolSidebar for the rules.

interface SidebarProps {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  domains: SidebarDomain[];
}

// Lists that act on the scope's deals, with their counts. The others are in
// the Deals page's list filter.
const ACTION_LISTS: { id: CrmList; label: string }[] = [
  { id: 'at-risk', label: 'At risk' }, { id: 'renewing', label: 'Renewing' }, { id: 'no-next-step', label: 'No next step' }, { id: 'incomplete', label: 'Missing details' },
];

export function CrmSidebar({ navigation, onNavigate, domains }: SidebarProps) {
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
  const listItem = (list: { id: CrmList; label: string }): ToolNavItem => ({
    id: `list:${list.id}`, label: t(list.label), count: listCount(list.id),
    active: !onRecord && route.view === 'deals' && route.list === list.id,
    onClick: () => go({ view: 'deals', list: list.id, pipelineId: null }),
  });

  // A group's pages: its home, its Companies, its Deals (a board when it has one pipeline).
  const open = (scope: ToolScope, patch: Partial<CrmRoute>) => { scoped.setScope(scope); go({ pipelineId: null, ...patch }); };
  const dealsView = (scope: ToolScope) => crm.pipelines.filter(item => scope === SPACE_SCOPE ? !item.domain_id : item.domain_id === scope).length <= 1 ? 'board' : 'deals';
  const here = (scope: ToolScope, ...views: CrmRoute['view'][]) => !onRecord && scoped.scope === scope && views.includes(route.view);
  const group = (scope: ToolScope, name: string, mark: ReactNode) => (
    <GroupTree key={scope ?? 'all'} name={name} mark={mark} defaultOpen={scoped.scope === scope}
      homeActive={here(scope, 'home')} onOpenHome={() => open(scope, { view: 'home' })}
      items={[
        { id: 'companies', label: t('Companies'), icon: Building2, active: here(scope, 'companies'), onClick: () => open(scope, { view: 'companies' }) },
        { id: 'deals', label: t('Deals'), icon: List, active: here(scope, 'deals', 'board') && !route.list, onClick: () => open(scope, { view: dealsView(scope) }) },
      ]} />
  );

  return <ToolSidebar
    title={t('CRM')}
    groups={<div className="mt-3">
      {domains.map(d => group(d.id, d.name, d.mark))}
      {scoped.hasShared && group(SPACE_SCOPE, t('Shared by the Space'), <Layers size={16} />)}
    </div>}
    scope={{
      value: scoped.scope, options: [], label: t('Everything'), icon: Layers,
      active: here(null, 'home'),
      onOpen: () => open(null, { view: 'home' }),
      onChange: () => {},
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
      { id: 'lists', label: t('Lists'), items: ACTION_LISTS.map(listItem) },
    ]}
    footer={[{ id: 'settings', label: t('Pipeline settings'), icon: Settings2, active: !!route.settings, onClick: () => go({ settings: true }) }]}
  />;
}
