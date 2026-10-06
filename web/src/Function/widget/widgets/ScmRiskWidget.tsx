'use client';

import { useMemo } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useScmData, useScmPlan } from '@/hooks/useScm';
import { Dot } from '@/ActivitySpace/sustainment/scm/ScmParts';
import { scopeScmData } from '@/ActivitySpace/sustainment/scm/scmScope';
import { setToolScope } from '@/Function/shared/tool/toolScope';
import { daysFrom, formatDay, HEALTH_LABEL, HEALTH_TONE } from '@/ActivitySpace/sustainment/scm/scmText';
import { useWidgetEmpty } from '../WidgetFrame';
import type { WidgetProps } from '../types';

/** Supply risks on any board: what runs out first, one click from the plan.
 * On a Domain it reads that Domain's supply — its locations and what they
 * hold — and says how well stocked it is. */
export function ScmRiskWidget({ host }: WidgetProps) {
  const { t, locale } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data: everything } = useScmData(spaceId);
  const domainId = host.subject.kind === 'domain' ? host.subject.id : null;
  const data = useMemo(() => everything && domainId ? scopeScmData(everything, domainId) : everything, [everything, domainId]);
  const plan = useScmPlan(data);
  const nodes = plan?.nodes ?? [];
  const risks = nodes.filter(node => node.health === 'stockout' || node.health === 'critical' || node.health === 'reorder')
    .sort((a, b) => (a.stockoutDay ?? '9999').localeCompare(b.stockoutDay ?? '9999')).slice(0, 6);
  // A Domain board shows its supply whenever the Domain holds stock; elsewhere only risks.
  useWidgetEmpty(domainId ? !data?.locations.length : !risks.length);
  if (!plan || !data) return null;
  const open = (key: string | null) => {
    host.onViewChange?.('scm');
    // The Domain's supply: SCM opens scoped to it, as its own sidebar would.
    if (domainId) setToolScope('scm', domainId);
    host.onNavigate?.({ scmView: (key || risks.length) ? 'exceptions' : 'inventory', scmNode: key, ...(domainId ? { scmLocationId: null } : {}) });
  };
  const openOrders = data.orders.filter(order => ['approved', 'sent', 'partial'].includes(order.status)).length;
  const drafts = data.orders.filter(order => order.status === 'draft').length;
  const stocked = nodes.filter(node => node.health !== 'stockout' && node.health !== 'critical').length;
  return <div className="space-y-2">
    {domainId && <button type="button" className="-mx-2 flex w-[calc(100%+1rem)] flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-md px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-muted/40" onClick={() => open(null)}>
      <span><span className="text-[13px] font-medium tabular-nums text-foreground">{nodes.length ? Math.round(stocked / nodes.length * 100) : 100}%</span> {t('stocked')}</span>
      <span>{t('{n} locations', { n: data.locations.length })}</span>
      <span>{t('{n} items', { n: nodes.length })}</span>
      {openOrders > 0 && <span>{t('{n} open orders', { n: openOrders })}</span>}
      {drafts > 0 && <span className="text-[var(--status-warning)]">{t('{n} awaiting approval', { n: drafts })}</span>}
    </button>}
    {risks.length > 0 && <ul className="-mx-2 space-y-0.5">
      {risks.map(node => {
        const days = node.stockoutDay ? daysFrom(plan.today, node.stockoutDay) : null;
        return <li key={node.key}>
          <button type="button" className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted/40" onClick={() => open(node.key)}>
            <Dot tone={HEALTH_TONE[node.health]} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px]">{node.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{t(HEALTH_LABEL[node.health])} · {data.locations.find(location => location.id === node.locationId)?.name}</span>
            </span>
            <span className={`shrink-0 text-[11px] tabular-nums ${days !== null && days < 3 ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
              {days === null ? '' : days <= 0 ? t('Today') : formatDay(node.stockoutDay, locale)}
            </span>
          </button>
        </li>;
      })}
    </ul>}
  </div>;
}
