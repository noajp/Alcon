'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { useScmData, useScmPlan } from '@/hooks/useScm';
import { Dot } from '@/ActivitySpace/sustainment/scm/ScmParts';
import { daysFrom, formatDay, HEALTH_LABEL, HEALTH_TONE } from '@/ActivitySpace/sustainment/scm/scmText';
import { useWidgetEmpty } from '../WidgetFrame';
import type { WidgetProps } from '../types';

/** The Space's supply risks on any board: what runs out first, one click from the plan. */
export function ScmRiskWidget({ host }: WidgetProps) {
  const { t, locale } = useI18n();
  const spaceId = useActiveSpaceId();
  const { data } = useScmData(spaceId);
  const plan = useScmPlan(data);
  const risks = (plan?.nodes ?? []).filter(node => node.health === 'stockout' || node.health === 'critical' || node.health === 'reorder')
    .sort((a, b) => (a.stockoutDay ?? '9999').localeCompare(b.stockoutDay ?? '9999')).slice(0, 6);
  useWidgetEmpty(!risks.length);
  if (!plan || !data) return null;
  const open = (key: string | null) => { host.onViewChange?.('scm'); host.onNavigate?.({ scmView: 'exceptions', scmNode: key }); };
  return <ul className="-mx-2 space-y-0.5">
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
  </ul>;
}
