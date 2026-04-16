'use client';

import { useMemo } from 'react';
import { format, formatDistanceToNow, differenceInDays, subDays } from 'date-fns';
import {
  PieChart,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Pie,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, Clock, Target } from 'lucide-react';
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { useDashboardData } from '@/hooks/useDashboardData';
import { SEMANTIC_COLORS, STATUS, FONT } from '@/shared/designTokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAllElements(objects: AlconObjectWithChildren[]): ElementWithDetails[] {
  const result: ElementWithDetails[] = [];
  const traverse = (objs: AlconObjectWithChildren[]) => {
    for (const obj of objs) {
      if (obj.elements) result.push(...obj.elements);
      if (obj.children) traverse(obj.children);
    }
  };
  traverse(objects);
  return result;
}

function getObjectElements(obj: AlconObjectWithChildren): ElementWithDetails[] {
  const result: ElementWithDetails[] = [];
  if (obj.elements) result.push(...obj.elements);
  if (obj.children) {
    for (const child of obj.children) {
      result.push(...getObjectElements(child));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Card wrapper — ActionCard aesthetic
// ---------------------------------------------------------------------------

const CARD =
  'rounded-2xl bg-white dark:bg-card border border-border/60 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.03)]';

const CARD_HOVER =
  'hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-shadow duration-200';

// ---------------------------------------------------------------------------
// KPI Card — 3-layer: number + trend + context
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: number | string;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
  context?: string;
  accent?: string;
  icon?: React.ReactNode;
}

function KpiCard({ label, value, trend, context, accent, icon }: KpiCardProps) {
  return (
    <div className={`${CARD} ${CARD_HOVER} p-5 flex flex-col gap-2 relative overflow-hidden`}>
      {/* Accent bar at top */}
      <div
        className="absolute top-0 inset-x-0 h-[3px] rounded-t-2xl"
        style={{
          background: accent
            ? `linear-gradient(90deg, ${accent}, ${accent}88)`
            : 'linear-gradient(90deg, #e5e7eb, #d1d5db)',
        }}
      />

      {/* Header: label + icon */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-muted-foreground/40">{icon}</span>}
      </div>

      {/* Value */}
      <span
        className="text-2xl font-semibold tracking-tight tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>

      {/* Trend + Context */}
      <div className="flex items-center gap-2 flex-wrap">
        {trend && (
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium ${
              trend.direction === 'up'
                ? 'text-emerald-600'
                : trend.direction === 'down'
                  ? 'text-red-500'
                  : 'text-muted-foreground'
            }`}
          >
            {trend.direction === 'up' && <TrendingUp size={12} />}
            {trend.direction === 'down' && <TrendingDown size={12} />}
            {trend.direction === 'flat' && <Minus size={12} />}
            {trend.label}
          </span>
        )}
        {context && (
          <span className="text-[11px] text-muted-foreground">{context}</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[13px] font-medium text-foreground mb-3">{children}</h3>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-[13px] text-muted-foreground">
      {message}
    </div>
  );
}

function ElementRow({ el, accentColor }: { el: ElementWithDetails; accentColor: string }) {
  const dueDate = el.due_date ? new Date(el.due_date) : null;
  const statusMeta = STATUS[el.status as keyof typeof STATUS];
  const isOverdue = dueDate && dueDate < new Date() && el.status !== 'done';
  const daysOverdue = dueDate && isOverdue ? differenceInDays(new Date(), dueDate) : 0;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground truncate">{el.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {statusMeta && (
            <span className={`text-[11px] ${statusMeta.color}`}>{statusMeta.label}</span>
          )}
          {dueDate && (
            <span
              className={`text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}
            >
              {isOverdue ? `${daysOverdue}d overdue` : format(dueDate, 'MMM d')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number; fill: string } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className={`${CARD} px-3 py-2`}>
      <p className="text-[11px] text-muted-foreground">{d.name}</p>
      <p className="text-lg font-semibold tabular-nums" style={{ color: d.fill }}>
        {d.value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface HomeViewProps {
  explorerData: ExplorerData;
}

export function HomeView({ explorerData }: HomeViewProps) {
  const allElements = useMemo(
    () => [...collectAllElements(explorerData.objects), ...explorerData.rootElements],
    [explorerData],
  );

  const {
    total,
    completedCount,
    completionRate,
    statusChartData,
    priorityChartData,
    overdueElements,
    upcomingElements,
    totalEstimated,
    totalActual,
  } = useDashboardData(allElements);

  const inProgressCount = allElements.filter((e) => e.status === 'in_progress').length;
  const blockedCount = allElements.filter((e) => e.status === 'blocked').length;
  const todoCount = allElements.filter((e) => e.status === 'todo').length;

  // Calculate "velocity" -- done items with due_date in last 14 days
  const recentDone = allElements.filter((e) => {
    if (e.status !== 'done' || !e.due_date) return false;
    return differenceInDays(new Date(), new Date(e.due_date)) <= 14;
  }).length;

  const hoursEfficiency =
    totalEstimated > 0 ? Math.round((totalActual / totalEstimated) * 100) : null;

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-lg font-semibold text-foreground">Dashboard</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            {total} elements across {explorerData.objects.length} objects
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            label="Completion"
            value={`${completionRate}%`}
            icon={<Target size={18} />}
            trend={{
              direction: completionRate >= 50 ? 'up' : completionRate > 0 ? 'flat' : 'down',
              label: `${completedCount} done`,
            }}
            context={`${todoCount} todo · ${inProgressCount} active`}
            accent="#10B981"
          />
          <KpiCard
            label="In Progress"
            value={inProgressCount}
            icon={<Clock size={18} />}
            trend={{
              direction: inProgressCount > 0 ? 'up' : 'flat',
              label: `${recentDone} completed recently`,
            }}
            context="Last 14 days velocity"
            accent="#F59E0B"
          />
          <KpiCard
            label="Overdue"
            value={overdueElements.length}
            icon={<AlertTriangle size={18} />}
            trend={{
              direction: overdueElements.length > 0 ? 'down' : 'up',
              label: overdueElements.length === 0 ? 'All on track' : 'Needs attention',
            }}
            context={
              overdueElements.length > 0
                ? `Oldest: ${differenceInDays(new Date(), new Date(overdueElements[0]?.due_date || ''))}d ago`
                : 'No blockers'
            }
            accent={overdueElements.length > 0 ? '#EF4444' : '#10B981'}
          />
          <KpiCard
            label="Hours Efficiency"
            value={hoursEfficiency !== null ? `${hoursEfficiency}%` : '\u2014'}
            icon={<CheckCircle2 size={18} />}
            trend={
              hoursEfficiency !== null
                ? {
                    direction: hoursEfficiency <= 100 ? 'up' : 'down',
                    label: hoursEfficiency <= 100 ? 'Under budget' : 'Over budget',
                  }
                : undefined
            }
            context={
              hoursEfficiency !== null
                ? `${totalActual}h actual / ${totalEstimated}h estimated`
                : 'No hours tracked'
            }
          />
        </div>

        {/* Charts Row */}
        {total > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Status Distribution */}
            <div className={`${CARD} p-5`}>
              <SectionTitle>Status Distribution</SectionTitle>
              {statusChartData.length > 0 ? (
                <div className="space-y-2.5 mt-2">
                  {statusChartData.map((item) => {
                    const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                    return (
                      <div key={item.name} className="flex items-center gap-3">
                        <span className="text-[11px] text-muted-foreground w-20 shrink-0 text-right">
                          {item.name}
                        </span>
                        <div className="flex-1 h-4 bg-muted/40 rounded-md overflow-hidden relative">
                          <div
                            className="h-full rounded-md transition-all duration-500"
                            style={{
                              width: `${Math.max(pct, item.value > 0 ? 3 : 0)}%`,
                              backgroundColor: item.fill,
                            }}
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-foreground/70 tabular-nums">
                            {item.value}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState message="No data" />
              )}
            </div>

            {/* Priority Breakdown */}
            <div className={`${CARD} p-5`}>
              <SectionTitle>Priority Breakdown</SectionTitle>
              {priorityChartData.length > 0 ? (
                <div className="flex items-center gap-6">
                  <div className="w-[160px] h-[160px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={priorityChartData}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={72}
                          paddingAngle={2}
                          dataKey="value"
                          stroke="none"
                        >
                          {priorityChartData.map((entry) => (
                            <Cell key={entry.name} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col gap-2.5 flex-1">
                    {priorityChartData.map((d) => {
                      const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                      return (
                        <div key={d.name} className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: d.fill }}
                          />
                          <span className="text-[13px] text-foreground flex-1">{d.name}</span>
                          <span className="text-[13px] font-medium text-foreground tabular-nums">
                            {d.value}
                          </span>
                          <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">
                            {pct}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState message="No data" />
              )}
            </div>
          </div>
        )}

        {/* Object Progress */}
        {explorerData.objects.length > 0 && (
          <div className={`${CARD} p-5`}>
            <SectionTitle>Object Progress</SectionTitle>
            <div className="space-y-3">
              {explorerData.objects.map((obj) => {
                const objElements = getObjectElements(obj);
                const done = objElements.filter((e) => e.status === 'done').length;
                const objTotal = objElements.length;
                const pct = objTotal > 0 ? Math.round((done / objTotal) * 100) : 0;
                const inProg = objElements.filter((e) => e.status === 'in_progress').length;
                const overdue = objElements.filter(
                  (e) =>
                    e.due_date && new Date(e.due_date) < new Date() && e.status !== 'done',
                ).length;

                return (
                  <div
                    key={obj.id}
                    className="flex items-center gap-4 px-3 py-2 -mx-3 rounded-lg hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[13px] font-medium text-foreground truncate">
                          {obj.name}
                        </span>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          {overdue > 0 && (
                            <span className="text-[10px] text-red-500 font-medium">
                              {overdue} overdue
                            </span>
                          )}
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {done}/{objTotal}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-muted/40 rounded-full overflow-hidden flex">
                        {/* Done portion */}
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${objTotal > 0 ? (done / objTotal) * 100 : 0}%`,
                            backgroundColor: SEMANTIC_COLORS.status.done,
                          }}
                        />
                        {/* In Progress portion */}
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${objTotal > 0 ? (inProg / objTotal) * 100 : 0}%`,
                            backgroundColor: SEMANTIC_COLORS.status.in_progress,
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-[13px] font-medium text-foreground tabular-nums w-10 text-right">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Overdue & Upcoming */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${CARD} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Overdue</SectionTitle>
              {overdueElements.length > 0 && (
                <span className="text-[11px] font-medium text-red-500 bg-red-50 dark:bg-red-950/30 px-2 py-0.5 rounded-full">
                  {overdueElements.length}
                </span>
              )}
            </div>
            {overdueElements.length > 0 ? (
              <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
                {overdueElements.slice(0, 10).map((el) => (
                  <ElementRow key={el.id} el={el} accentColor={SEMANTIC_COLORS.status.blocked} />
                ))}
                {overdueElements.length > 10 && (
                  <p className="text-[11px] text-muted-foreground text-center pt-2">
                    +{overdueElements.length - 10} more
                  </p>
                )}
              </div>
            ) : (
              <EmptyState message="No overdue items" />
            )}
          </div>

          <div className={`${CARD} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <SectionTitle>Upcoming 7 Days</SectionTitle>
              {upcomingElements.length > 0 && (
                <span className="text-[11px] font-medium text-amber-600 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">
                  {upcomingElements.length}
                </span>
              )}
            </div>
            {upcomingElements.length > 0 ? (
              <div className="space-y-0.5 max-h-[300px] overflow-y-auto">
                {upcomingElements.slice(0, 10).map((el) => (
                  <ElementRow key={el.id} el={el} accentColor={SEMANTIC_COLORS.status.in_progress} />
                ))}
                {upcomingElements.length > 10 && (
                  <p className="text-[11px] text-muted-foreground text-center pt-2">
                    +{upcomingElements.length - 10} more
                  </p>
                )}
              </div>
            ) : (
              <EmptyState message="Nothing due this week" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
