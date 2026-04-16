'use client';
import { useMemo } from 'react';
import { differenceInDays } from 'date-fns';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Clock, Target, CheckCircle2 } from 'lucide-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { CARD, CARD_HOVER } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

interface Props { elements: ElementWithDetails[]; }

function KpiCard({ label, value, trend, context, accent, icon }: {
  label: string; value: number | string;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
  context?: string; accent?: string; icon?: React.ReactNode;
}) {
  return (
    <div className={`${CARD} ${CARD_HOVER} p-5 flex flex-col gap-2 relative overflow-hidden`}>
      <div className="absolute top-0 inset-x-0 h-[3px] rounded-t-2xl"
        style={{ background: accent ? `linear-gradient(90deg, ${accent}, ${accent}88)` : 'linear-gradient(90deg, #e5e7eb, #d1d5db)' }} />
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground/40">{icon}</span>}
      </div>
      <span className="text-2xl font-semibold tracking-tight tabular-nums" style={accent ? { color: accent } : undefined}>{value}</span>
      <div className="flex items-center gap-2 flex-wrap">
        {trend && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
            trend.direction === 'up' ? 'text-emerald-600' :
            trend.direction === 'down' ? 'text-red-500' : 'text-muted-foreground'}`}>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Completion" value={`${completionRate}%`} icon={<Target size={18} />}
        trend={{ direction: completionRate >= 50 ? 'up' : completionRate > 0 ? 'flat' : 'down', label: `${completedCount} done` }}
        context={`${todoCount} todo · ${inProgressCount} active`} accent="#10B981" />
      <KpiCard label="In Progress" value={inProgressCount} icon={<Clock size={18} />}
        trend={{ direction: inProgressCount > 0 ? 'up' : 'flat', label: `${recentDone} completed recently` }}
        context="Last 14 days velocity" accent="#F59E0B" />
      <KpiCard label="Overdue" value={overdueElements.length} icon={<AlertTriangle size={18} />}
        trend={{ direction: overdueElements.length > 0 ? 'down' : 'up', label: overdueElements.length === 0 ? 'All on track' : 'Needs attention' }}
        context={overdueElements.length > 0 ? `Oldest: ${differenceInDays(new Date(), new Date(overdueElements[0]?.due_date || ''))}d ago` : 'No blockers'}
        accent={overdueElements.length > 0 ? '#EF4444' : '#10B981'} />
      <KpiCard label="Hours" value={hoursEfficiency !== null ? `${hoursEfficiency}%` : '—'} icon={<CheckCircle2 size={18} />}
        trend={hoursEfficiency !== null ? { direction: hoursEfficiency <= 100 ? 'up' : 'down', label: hoursEfficiency <= 100 ? 'Under budget' : 'Over budget' } : undefined}
        context={hoursEfficiency !== null ? `${totalActual}h / ${totalEstimated}h est.` : 'No hours tracked'} />
    </div>
  );
}
