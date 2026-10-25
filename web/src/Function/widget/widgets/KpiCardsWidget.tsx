'use client';
import { useMemo } from 'react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';
import { daysOverdue } from '@/Function/shared/dateUtils';

interface Props { elements: ElementWithDetails[]; }

function Figure({ label, value, detail, alarm = false }: {
  label: string; value: number | string; detail: string; alarm?: boolean;
}) {
  // A figure on the page, not a tile: no box, no icon, no colour for its own
  // sake. The number is foreground; only a number that asks for action (an
  // overdue count) turns red.
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[22px] font-semibold leading-7 tabular-nums text-foreground" style={alarm ? { color: SEMANTIC_COLORS.danger } : undefined}>{value}</span>
      <span className="truncate text-[12px] text-muted-foreground">{detail}</span>
    </div>
  );
}

export function KpiCardsWidget({ elements }: Props) {
  const { t } = useI18n();
  const { completedCount, completionRate, overdueElements, totalEstimated, totalActual } = useDashboardData(elements);
  const inProgressCount = useMemo(() => elements.filter(e => e.status === 'in_progress').length, [elements]);
  const todoCount = useMemo(() => elements.filter(e => e.status === 'todo').length, [elements]);
  const recentDone = useMemo(() => elements.filter(e => {
    if (e.status !== 'done' || !e.due_date) return false;
    return daysOverdue(e.due_date) <= 14;
  }).length, [elements]);
  const hoursEfficiency = totalEstimated > 0 ? Math.round((totalActual / totalEstimated) * 100) : null;
  const oldest = overdueElements[0]?.due_date;

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
      <Figure label={t('Completion')} value={`${completionRate}%`} detail={t('{done} done · {todo} todo · {active} active', { done: completedCount, todo: todoCount, active: inProgressCount })} />
      <Figure label={t('In Progress')} value={inProgressCount} detail={t('{n} done in the last 14 days', { n: recentDone })} />
      <Figure label={t('Overdue')} value={overdueElements.length} alarm={overdueElements.length > 0}
        detail={oldest ? t('Oldest {n}d ago', { n: daysOverdue(oldest) }) : t('All on track')} />
      <Figure label={t('Hours')} value={hoursEfficiency !== null ? `${hoursEfficiency}%` : '—'}
        detail={hoursEfficiency !== null ? t('{actual}h of {estimated}h estimated', { actual: totalActual, estimated: totalEstimated }) : t('No hours tracked')} />
    </div>
  );
}
