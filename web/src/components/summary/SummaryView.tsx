'use client';

import { format, formatDistanceToNow, differenceInDays } from 'date-fns';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { useDashboardData } from '@/hooks/useDashboardData';
import { SEMANTIC_COLORS, STATUS, PRIORITY } from '@/shared/designTokens';
import type { ElementWithDetails, AlconObjectWithChildren } from '@/types/database';

// ─── Priority chart colors ──────────────────────────────────
const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#EF4444',
  high: '#F59E0B',
  medium: '#A3A3A3',
  low: '#D4D4D4',
};

// ─── Types ──────────────────────────────────────────────────
interface SummaryViewProps {
  elements: ElementWithDetails[];
  object: AlconObjectWithChildren;
}

// ─── Completion Ring ────────────────────────────────────────
function CompletionRing({
  completionRate,
  completedCount,
  total,
}: {
  completionRate: number;
  completedCount: number;
  total: number;
}) {
  const data = [{ name: 'completed', value: completionRate, fill: '#10B981' }];

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">Completion</h3>
      {total === 0 ? (
        <div className="flex items-center justify-center h-[180px] text-muted-foreground text-xs">
          No elements yet
        </div>
      ) : (
        <div className="relative flex items-center justify-center h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius="70%"
              outerRadius="90%"
              startAngle={90}
              endAngle={-270}
              data={data}
              barSize={12}
            >
              <RadialBar
                background={{ fill: '#F5F5F5' }}
                dataKey="value"
                cornerRadius={6}
                isAnimationActive
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-3xl font-bold text-foreground tracking-tight">
              {completionRate}%
            </span>
            <span className="text-muted-foreground text-xs mt-0.5">
              {completedCount}/{total}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Status Breakdown ───────────────────────────────────────
function StatusBreakdown({
  statusChartData,
}: {
  statusChartData: Array<{ name: string; value: number; fill: string }>;
}) {
  const maxValue = Math.max(...statusChartData.map((d) => d.value), 1);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">Status</h3>
      {statusChartData.length === 0 ? (
        <div className="flex items-center justify-center h-[180px] text-muted-foreground text-xs">
          No data
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 justify-center min-h-[180px]">
          {statusChartData.map((item) => {
            const statusColor =
              SEMANTIC_COLORS.status[item.name as keyof typeof SEMANTIC_COLORS.status] ?? '#A3A3A3';
            const widthPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;

            return (
              <div key={item.name} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-20 shrink-0 text-right">
                  {item.name}
                </span>
                <div className="flex-1 h-5 bg-neutral-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(widthPct, item.value > 0 ? 4 : 0)}%`,
                      backgroundColor: statusColor,
                    }}
                  />
                </div>
                <span className="text-xs font-medium text-foreground w-6 text-right tabular-nums">
                  {item.value}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Priority Distribution ──────────────────────────────────
function PriorityDistribution({
  priorityChartData,
}: {
  priorityChartData: Array<{ name: string; value: number; fill: string }>;
}) {
  const hasData = priorityChartData.some((d) => d.value > 0);

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">Priority</h3>
      {!hasData ? (
        <div className="flex items-center justify-center h-[180px] text-muted-foreground text-xs">
          No priorities assigned
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <div className="h-[150px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={priorityChartData.filter((d) => d.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={65}
                  paddingAngle={3}
                  dataKey="value"
                  stroke="none"
                >
                  {priorityChartData
                    .filter((d) => d.value > 0)
                    .map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={entry.fill}
                      />
                    ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid #E5E5E5',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
            {priorityChartData
              .filter((d) => d.value > 0)
              .map((entry) => (
                <div key={entry.name} className="flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: entry.fill }}
                  />
                  <span className="text-xs text-muted-foreground">
                    {entry.name} ({entry.value})
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Hours Tracking ─────────────────────────────────────────
function HoursTracking({
  totalEstimated,
  totalActual,
}: {
  totalEstimated: number;
  totalActual: number;
}) {
  const hasData = totalEstimated > 0 || totalActual > 0;
  const barData = [
    { label: 'Estimated', hours: totalEstimated },
    { label: 'Actual', hours: totalActual },
  ];

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">Hours</h3>
      {!hasData ? (
        <div className="flex items-center justify-center h-[180px] text-muted-foreground text-xs">
          No hours tracked yet
        </div>
      ) : (
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} barCategoryGap="30%">
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: '#737373' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#A3A3A3' }}
                axisLine={false}
                tickLine={false}
                width={36}
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid #E5E5E5',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                }}
                formatter={(value) => [`${value}h`, 'Hours']}
              />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                <Cell fill="#262626" />
                <Cell fill={totalActual > totalEstimated ? '#EF4444' : '#10B981'} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Priority Badge ─────────────────────────────────────────
function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const config = PRIORITY[priority as keyof typeof PRIORITY];
  if (!config) return null;

  return (
    <Badge variant="outline" className={`text-[11px] px-1.5 py-0 ${config.badgeBg} border-0`}>
      {config.label}
    </Badge>
  );
}

// ─── Status Dot ─────────────────────────────────────────────
function StatusDot({ status }: { status: string | null }) {
  const statusConfig = status ? STATUS[status as keyof typeof STATUS] : null;
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${statusConfig?.dot ?? 'bg-neutral-300'}`}
    />
  );
}

// ─── Overdue List ───────────────────────────────────────────
function OverdueList({
  overdueElements,
}: {
  overdueElements: ElementWithDetails[];
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">Overdue</h3>
      {overdueElements.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
          Nothing overdue
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {overdueElements.slice(0, 10).map((el) => {
            const dueDate = el.due_date ? new Date(el.due_date) : null;
            const daysOverdue = dueDate ? differenceInDays(new Date(), dueDate) : 0;

            return (
              <li
                key={el.id}
                className="flex items-center gap-3 rounded-lg px-3 py-2 border-l-2 border-red-400 bg-red-50/40 hover:bg-red-50/70 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{el.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {dueDate ? format(dueDate, 'MMM d') : 'No date'}{' '}
                    <span className="text-red-500 font-medium">
                      ({daysOverdue}d overdue)
                    </span>
                  </p>
                </div>
                <PriorityBadge priority={el.priority} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Upcoming List ──────────────────────────────────────────
function UpcomingList({
  upcomingElements,
}: {
  upcomingElements: ElementWithDetails[];
}) {
  // Group by date
  const grouped = upcomingElements.reduce<Record<string, ElementWithDetails[]>>((acc, el) => {
    const dateKey = el.due_date ? format(new Date(el.due_date), 'yyyy-MM-dd') : 'no-date';
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(el);
    return acc;
  }, {});

  const sortedDates = Object.keys(grouped).sort();

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <h3 className="text-sm font-medium text-foreground mb-3">Upcoming (7 days)</h3>
      {upcomingElements.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-muted-foreground text-xs">
          Nothing upcoming
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedDates.map((dateKey) => {
            const items = grouped[dateKey];
            const dateLabel =
              dateKey === 'no-date'
                ? 'No date'
                : formatDistanceToNow(new Date(dateKey), { addSuffix: true });
            const dateFormatted =
              dateKey === 'no-date' ? '' : format(new Date(dateKey), 'EEE, MMM d');

            return (
              <div key={dateKey}>
                <div className="flex items-baseline gap-2 mb-1.5">
                  <span className="text-xs font-medium text-foreground">{dateFormatted}</span>
                  <span className="text-[11px] text-muted-foreground">{dateLabel}</span>
                </div>
                <ul className="flex flex-col gap-1">
                  {items.map((el) => (
                    <li
                      key={el.id}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 hover:bg-neutral-50 transition-colors"
                    >
                      <StatusDot status={el.status} />
                      <span className="text-sm text-foreground truncate flex-1 min-w-0">
                        {el.title}
                      </span>
                      <PriorityBadge priority={el.priority} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
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

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {/* Row 1 — Completion + Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CompletionRing
            completionRate={completionRate}
            completedCount={completedCount}
            total={total}
          />
          <StatusBreakdown statusChartData={statusChartData} />
        </div>

        {/* Row 2 — Priority + Hours */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PriorityDistribution priorityChartData={priorityChartData} />
          <HoursTracking totalEstimated={totalEstimated} totalActual={totalActual} />
        </div>

        {/* Row 3 — Overdue + Upcoming */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OverdueList overdueElements={overdueElements} />
          <UpcomingList upcomingElements={upcomingElements} />
        </div>
      </div>
    </div>
  );
}
