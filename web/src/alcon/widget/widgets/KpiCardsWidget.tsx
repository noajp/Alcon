'use client';
import { useMemo } from 'react';
import { differenceInDays } from 'date-fns';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Clock, Target, CheckCircle2 } from 'lucide-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

interface Props { elements: ElementWithDetails[]; }

function KpiCard({ label, value, trend, context, accent, icon }: {
  label: string; value: number | string;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
  context?: string; accent?: string; icon?: React.ReactNode;
}) {
  return (
    // A cell, not a card. The widget frame is the box now, so the tiles that
    // used to be four cards inside a fifth are four cells divided by
    // hairlines — and the decorative accent gradient that topped each one is
    // gone with them (DESIGN.md §9-7: elevation is not decoration).
    <div className="bg-card p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground/40">{icon}</span>}
      </div>
      <span className="text-2xl font-semibold tracking-normal tabular-nums" style={accent ? { color: accent } : undefined}>{value}</span>
      <div className="flex items-center gap-2 flex-wrap">
        {trend && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
            trend.direction === 'up' ? 'text-[var(--status-success)]' :
            trend.direction === 'down' ? 'text-[var(--status-danger)]' : 'text-muted-foreground'}`}>
            {trend.direction === 'up' && <TrendingUp size={12} />}
            {trend.direction === 'down' && <TrendingDown size={12} />}
            {trend.direction === 'flat' && <Minus size={12} />}
            {trend.label}
          </span>
        )}
        {context && <span className="text-[11px] text-muted-foreground">{context}</span>}
      </div>
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

  return (
    // `gap-px` over the border colour draws the hairlines: it gives the same
    // grid one divider between every pair of neighbours at every breakpoint,
    // without a rule per column count.
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-border/60">
      <KpiCard label="Completion" value={`${completionRate}%`} icon={<Target size={18} />}
        trend={{ direction: completionRate >= 50 ? 'up' : completionRate > 0 ? 'flat' : 'down', label: `${completedCount} done` }}
        context={`${todoCount} todo · ${inProgressCount} active`} accent={SEMANTIC_COLORS.status.done} />
      <KpiCard label="In Progress" value={inProgressCount} icon={<Clock size={18} />}
        trend={{ direction: inProgressCount > 0 ? 'up' : 'flat', label: `${recentDone} completed recently` }}
        context="Last 14 days velocity" accent={SEMANTIC_COLORS.status.in_progress} />
      <KpiCard label="Overdue" value={overdueElements.length} icon={<AlertTriangle size={18} />}
        trend={{ direction: overdueElements.length > 0 ? 'down' : 'up', label: overdueElements.length === 0 ? 'All on track' : 'Needs attention' }}
        context={overdueElements.length > 0 ? `Oldest: ${differenceInDays(new Date(), new Date(overdueElements[0]?.due_date || ''))}d ago` : 'No blockers'}
        accent={overdueElements.length > 0 ? SEMANTIC_COLORS.danger : SEMANTIC_COLORS.status.done} />
      <KpiCard label="Hours" value={hoursEfficiency !== null ? `${hoursEfficiency}%` : '—'} icon={<CheckCircle2 size={18} />}
        trend={hoursEfficiency !== null ? { direction: hoursEfficiency <= 100 ? 'up' : 'down', label: hoursEfficiency <= 100 ? 'Under budget' : 'Over budget' } : undefined}
        context={hoursEfficiency !== null ? `${totalActual}h / ${totalEstimated}h est.` : 'No hours tracked'} />
    </div>
  );
}
