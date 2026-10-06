'use client';

import { useMemo } from 'react';
import { AlertTriangle, Bot, Boxes, Layers, MapPin, Truck, Warehouse } from 'lucide-react';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ToolSidebar } from '@/Function/shared/tool/ToolSidebar';
import { useScmData, useScmPlan } from '@/hooks/useScm';
import type { NavigationState } from '@/types/navigation';
import { scopeScmData } from './scmScope';
import { useScmScope } from './scmScopeState';
import { ROOT_VIEWS, scmViewOf, type ScmView } from './scmNavigation';

// The SCM sidebar, on the shared ToolSidebar: the scope (whose supply — its
// row opens the control tower), Needs attention, the collections with their
// saved filters, and the autopilot at the foot. See ToolSidebar for the rules.

export function ScmSidebar({ navigation, onNavigate, onOpen }: {
  navigation: NavigationState;
  onNavigate: (navigation: Partial<NavigationState>) => void;
  /** Make sure the main pane shows SCM. */
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: everything } = useScmData(spaceId);
  const { scope, setScope, scopeName, options } = useScmScope(everything);
  const data = useMemo(() => everything ? scopeScmData(everything, scope) : null, [everything, scope]);
  const plan = useScmPlan(data);
  const view = scmViewOf(navigation);
  const onRecord = !!(navigation.scmNode || navigation.scmOrderId || navigation.scmSupplierId);
  const clear = { scmNode: null, scmOrderId: null, scmSupplierId: null, scmHealth: null, scmSupplierDelay: null, scmLedgerItemId: null, scmCatalog: null, scmOrderFilter: null, scmLocationId: null } as const;
  const go = (next: ScmView, extra: Partial<NavigationState> = {}) => { onOpen(); onNavigate({ ...clear, scmView: next, ...extra }); };

  // What acting would make smaller — the only numbers this sidebar shows.
  const counts = useMemo(() => {
    if (!data || !plan) return { drafts: 0, late: 0, atRisk: 0 };
    const open = data.orders.filter(order => ['approved', 'sent', 'partial'].includes(order.status));
    return {
      drafts: data.orders.filter(order => order.status === 'draft').length,
      late: open.filter(order => order.expectedOn < data.today).length,
      atRisk: plan.nodes.filter(node => node.health === 'stockout' || node.health === 'critical').length,
    };
  }, [data, plan]);
  const at = (target: ScmView) => !onRecord && view === target;
  const empty = !data?.items.length;

  return <ToolSidebar
    title="SCM"
    scope={{
      value: scope, options, label: scopeName, icon: Layers,
      active: !onRecord && ROOT_VIEWS.includes(view),
      onOpen: () => go('tower'),
      onChange: next => { setScope(next); go('tower'); },
    }}
    queue={empty ? [] : [{
      id: 'attention', label: t('Needs attention'), icon: AlertTriangle, count: counts.drafts + counts.late + counts.atRisk,
      active: at('exceptions'), onClick: () => go('exceptions'),
    }]}
    sections={empty ? [] : [{ id: 'collections', items: [
      { id: 'orders', label: t('Purchase orders'), icon: Truck, active: at('orders') && (navigation.scmOrderFilter ?? 'open') === 'open', onClick: () => go('orders'), children: [
        { id: 'orders:late', label: t('Late'), count: counts.late, active: at('orders') && navigation.scmOrderFilter === 'late', onClick: () => go('orders', { scmOrderFilter: 'late' }) },
        { id: 'orders:draft', label: t('Awaiting approval'), count: counts.drafts, active: at('orders') && navigation.scmOrderFilter === 'draft', onClick: () => go('orders', { scmOrderFilter: 'draft' }) },
      ] },
      { id: 'items', label: t('Items'), icon: Boxes, active: at('inventory') && !navigation.scmHealth, onClick: () => go('inventory'), children: [
        { id: 'items:risk', label: t('At risk'), count: counts.atRisk, active: at('inventory') && navigation.scmHealth === 'at-risk', onClick: () => go('inventory', { scmHealth: 'at-risk' }) },
      ] },
      { id: 'suppliers', label: t('Suppliers'), icon: Warehouse, active: at('suppliers'), onClick: () => go('suppliers') },
      { id: 'locations', label: t('Locations'), icon: MapPin, active: at('locations'), onClick: () => go('locations') },
    ] }]}
    footer={data ? [{
      id: 'autopilot', icon: Bot, active: at('settings'), onClick: () => go('settings'),
      label: <span className="min-w-0"><span className="block truncate">{t('Autopilot')}</span><span className="block truncate text-[11px] font-normal text-muted-foreground/70">{data.policy.autopilotEnabled ? t('On · approves up to {n}', { n: data.policy.autoApproveLimit.toLocaleString() }) : t('Off · proposals only')}</span></span>,
    }] : []}
  />;
}
