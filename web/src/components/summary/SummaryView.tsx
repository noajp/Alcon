'use client';

import { useMemo } from 'react';
import { format, differenceInDays } from 'date-fns';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Clock, Target, CheckCircle2 } from 'lucide-react';
import { useDashboardData } from '@/hooks/useDashboardData';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import type { ElementWithDetails, AlconObjectWithChildren } from '@/types/database';

// ─── Types ──────────────────────────────────────────────────
interface SummaryViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
}

// ─── KPI Card (same design as HomeView) ─────────────────────
function KpiCard({ label, value, trend, context, accent, icon }: {
  label: string;
  value: number | string;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
  context?: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground/40">{icon}</span>}
      </div>
      <span className="text-2xl font-bold tracking-tight tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </span>
      <div className="flex items-center gap-2 flex-wrap">
        {trend && (
          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
            trend.direction === 'up' ? 'text-emerald-600' :
            trend.direction === 'down' ? 'text-red-500' :
            'text-muted-foreground'
          }`}>
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

// ─── Sub-components ─────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-foreground mb-3">{children}</h3>;
}

function ElementRow({ el, accentColor }: { el: ElementWithDetails; accentColor: string }) {
  const dueDate = el.due_date ? new Date(el.due_date) : null;
  const statusMeta = STATUS[el.status as keyof typeof STATUS];
  const isOverdue = dueDate && dueDate < new Date() && el.status !== 'done';
  const daysOverdue = dueDate && isOverdue ? differenceInDays(new Date(), dueDate) : 0;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
      style={{ borderLeft: `3px solid ${accentColor}` }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{el.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {statusMeta && <span className={`text-[11px] ${statusMeta.color}`}>{statusMeta.label}</span>}
          {dueDate && (
            <span className={`text-[11px] ${isOverdue ? 'text-red-500' : 'text-muted-foreground'}`}>
              {isOverdue ? `${daysOverdue}d overdue` : format(dueDate, 'MMM d')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number; fill: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs text-muted-foreground">{d.name}</p>
      <p className="text-lg font-bold tabular-nums" style={{ color: d.fill }}>{d.value}</p>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export function SummaryView({ elements, object }: SummaryViewProps) {
  const {
    completionRate,
    completedCount,
    total,
    totalEstimated,
    totalActual,
    overdueElements,
    upcomingElements,
    statusChartData,
    priorityChartData,
  } = useDashboardData(elements);

  const inProgressCount = elements.filter(e => e.status === 'in_progress').length;
  const blockedCount = elements.filter(e => e.status === 'blocked').length;
  const hoursEfficiency = totalEstimated > 0 ? Math.round((totalActual / totalEstimated) * 100) : null;

  // Radial chart data for completion ring
  const radialData = [{ value: completionRate, fill: '#10B981' }];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── KPI Cards ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Completion"
            value={`${completionRate}%`}
            icon={<Target size={16} />}
            trend={{
              direction: completionRate >= 50 ? 'up' : completionRate > 0 ? 'flat' : 'down',
              label: `${completedCount} of ${total}`,
            }}
            context={`${total - completedCount} remaining`}
            accent="#10B981"
          />
          <KpiCard
            label="Active"
            value={inProgressCount}
            icon={<Clock size={16} />}
            trend={{
              direction: inProgressCount > 0 ? 'up' : 'flat',
              label: blockedCount > 0 ? `${blockedCount} blocked` : 'No blockers',
            }}
            context={`${inProgressCount + blockedCount} in flight`}
            accent="#F59E0B"
          />
          <KpiCard
            label="Overdue"
            value={overdueElements.length}
            icon={<AlertTriangle size={16} />}
            trend={{
              direction: overdueElements.length > 0 ? 'down' : 'up',
              label: overdueElements.length === 0 ? 'On track' : 'Needs attention',
            }}
            context={overdueElements.length > 0
              ? `Oldest: ${differenceInDays(new Date(), new Date(overdueElements[0]?.due_date || ''))}d`
              : `${upcomingElements.length} due this week`}
            accent={overdueElements.length > 0 ? '#EF4444' : '#10B981'}
          />
          <KpiCard
            label="Hours"
            value={hoursEfficiency !== null ? `${hoursEfficiency}%` : '—'}
            icon={<CheckCircle2 size={16} />}
            trend={hoursEfficiency !== null ? {
              direction: hoursEfficiency <= 100 ? 'up' : 'down',
              label: hoursEfficiency <= 100 ? 'Under budget' : 'Over budget',
            } : undefined}
            context={hoursEfficiency !== null
              ? `${totalActual}h / ${totalEstimated}h est.`
              : 'No hours tracked'}
          />
        </div>

        {/* ── Charts ────────────────────────────────────────── */}
        {total > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Status bars */}
            <div className="bg-card rounded-xl border border-border p-5">
              <SectionTitle>Status Distribution</SectionTitle>
              {statusChartData.length > 0 ? (
                <div className="space-y-2.5 mt-2">
                  {statusChartData.map(item => {
                    const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                    return (
                      <div key={item.name} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-20 shrink-0 text-right">{item.name}</span>
                        <div className="flex-1 h-5 bg-muted/50 rounded-md overflow-hidden relative">
                          <div
                            className="h-full rounded-md transition-all duration-500"
                            style={{ width: `${Math.max(pct, item.value > 0 ? 3 : 0)}%`, backgroundColor: item.fill }}
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-foreground/70 tabular-nums">
                            {item.value}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {/* Priority donut */}
            <div className="bg-card rounded-xl border border-border p-5">
              <SectionTitle>Priority Breakdown</SectionTitle>
              {priorityChartData.length > 0 ? (
                <div className="flex items-center gap-6">
                  <div className="w-[140px] h-[140px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={priorityChartData} cx="50%" cy="50%" innerRadius={40} outerRadius={64} paddingAngle={2} dataKey="value" stroke="none">
                          {priorityChartData.map(entry => <Cell key={entry.name} fill={entry.fill} />)}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-2 flex-1">
                    {priorityChartData.map(d => {
                      const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                      return (
                        <div key={d.name} className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="text-sm text-foreground flex-1">{d.name}</span>
                          <span className="text-sm text-foreground tabular-nums">{d.value}</span>
                          <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* ── Overdue & Upcoming ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Overdue</SectionTitle>
              {overdueElements.length > 0 && (
                <span className="text-xs font-medium text-red-500 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded-full">
                  {overdueElements.length}
                </span>
              )}
            </div>
            {overdueElements.length > 0 ? (
              <div className="space-y-1 max-h-[260px] overflow-y-auto">
                {overdueElements.slice(0, 8).map(el => (
                  <ElementRow key={el.id} el={el} accentColor={SEMANTIC_COLORS.status.blocked} />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">No overdue items</div>
            )}
          </div>

          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Upcoming 7 Days</SectionTitle>
              {upcomingElements.length > 0 && (
                <span className="text-xs font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">
                  {upcomingElements.length}
                </span>
              )}
            </div>
            {upcomingElements.length > 0 ? (
              <div className="space-y-1 max-h-[260px] overflow-y-auto">
                {upcomingElements.slice(0, 8).map(el => (
                  <ElementRow key={el.id} el={el} accentColor={SEMANTIC_COLORS.status.in_progress} />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">Nothing due this week</div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
