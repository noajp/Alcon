'use client';
import { useMemo } from 'react';
import { differenceInDays } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

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
  const { completedCount, completionRate, overdueElements, totalEstimated, totalActual } = useDashboardData(elements);
  const inProgressCount = useMemo(() => elements.filter(e => e.status === 'in_progress').length, [elements]);
  const todoCount = useMemo(() => elements.filter(e => e.status === 'todo').length, [elements]);
  const recentDone = useMemo(() => elements.filter(e => {
    if (e.status !== 'done' || !e.due_date) return false;
    return differenceInDays(new Date(), new Date(e.due_date)) <= 14;
  }).length, [elements]);
  const hoursEfficiency = totalEstimated > 0 ? Math.round((totalActual / totalEstimated) * 100) : null;
  const oldest = overdueElements[0]?.due_date;

  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
      <Figure label="Completion" value={`${completionRate}%`} detail={`${completedCount} done · ${todoCount} todo · ${inProgressCount} active`} />
      <Figure label="In Progress" value={inProgressCount} detail={`${recentDone} done in the last 14 days`} />
      <Figure label="Overdue" value={overdueElements.length} alarm={overdueElements.length > 0}
        detail={oldest ? `Oldest ${differenceInDays(new Date(), new Date(oldest))}d ago` : 'All on track'} />
      <Figure label="Hours" value={hoursEfficiency !== null ? `${hoursEfficiency}%` : '—'}
        detail={hoursEfficiency !== null ? `${totalActual}h of ${totalEstimated}h estimated` : 'No hours tracked'} />
    </div>
  );
}
