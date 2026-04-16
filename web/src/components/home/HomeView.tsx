'use client';

import { format, formatDistanceToNow } from 'date-fns';
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
import type { ExplorerData, AlconObjectWithChildren, ElementWithDetails } from '@/hooks/useSupabase';
import { useDashboardData } from '@/hooks/useDashboardData';
import { SEMANTIC_COLORS, STATUS, FONT } from '@/shared/designTokens';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAllElements(objects: AlconObjectWithChildren[]): ElementWithDetails[] {
  const elements: ElementWithDetails[] = [];
  const traverse = (objs: AlconObjectWithChildren[]) => {
    for (const obj of objs) {
      if (obj.elements) elements.push(...obj.elements);
      if (obj.children) traverse(obj.children);
    }
  };
  traverse(objects);
  return elements;
}

function getObjectElements(obj: AlconObjectWithChildren): ElementWithDetails[] {
  const elements: ElementWithDetails[] = [];
  if (obj.elements) elements.push(...obj.elements);
  if (obj.children) {
    for (const child of obj.children) {
      elements.push(...getObjectElements(child));
    }
  }
  return elements;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KpiCard({
  label,
  value,
  subtitle,
  accent,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  accent?: string;
}) {
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex flex-col gap-1">
      <span className={FONT.label}>{label}</span>
      <span
        className="text-2xl font-semibold tracking-tight"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </span>
      {subtitle && (
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      )}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return <h2 className={`${FONT.label} mb-3`}>{children}</h2>;
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function ElementRow({
  el,
  accentColor,
}: {
  el: ElementWithDetails;
  accentColor: string;
}) {
  const dueDate = el.due_date ? new Date(el.due_date) : null;
  const statusMeta = STATUS[el.status as keyof typeof STATUS];

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {el.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {statusMeta && (
            <span className={`text-[11px] ${statusMeta.color}`}>
              {statusMeta.label}
            </span>
          )}
          {dueDate && (
            <span className="text-[11px] text-muted-foreground">
              {format(dueDate, 'MMM d')} ({formatDistanceToNow(dueDate, { addSuffix: true })})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom Tooltip for charts
// ---------------------------------------------------------------------------

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
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-foreground">{d.name}</p>
      <p className="text-lg font-semibold" style={{ color: d.fill }}>
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
  const allElements = [
    ...collectAllElements(explorerData.objects),
    ...explorerData.rootElements,
  ];

  const {
    total,
    completedCount,
    completionRate,
    statusChartData,
    priorityChartData,
    overdueElements,
    upcomingElements,
  } = useDashboardData(allElements);

  const inProgressCount = allElements.filter(
    (e) => e.status === 'in_progress'
  ).length;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      {/* Header */}
      <div className="px-6 pt-6 pb-2">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
      </div>

      <div className="p-6 space-y-6">
        {/* ---- KPI Cards ---- */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Elements" value={total} />
          <KpiCard
            label="Completed"
            value={completedCount}
            subtitle={`${completionRate}% completion`}
            accent="#10B981"
          />
          <KpiCard
            label="In Progress"
            value={inProgressCount}
            accent="#F59E0B"
          />
          <KpiCard
            label="Overdue"
            value={overdueElements.length}
            subtitle={
              overdueElements.length > 0 ? 'Needs attention' : 'All on track'
            }
            accent="#EF4444"
          />
        </div>

        {/* ---- Charts ---- */}
        {total > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status Distribution */}
            <div className="bg-card rounded-xl border border-border p-4">
              <SectionHeader>Status Distribution</SectionHeader>
              {statusChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    data={statusChartData}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={80}
                      tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ fill: 'var(--muted)', opacity: 0.3 }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                      {statusChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState message="No status data" />
              )}
            </div>

            {/* Priority Breakdown */}
            <div className="bg-card rounded-xl border border-border p-4">
              <SectionHeader>Priority Breakdown</SectionHeader>
              {priorityChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={priorityChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {priorityChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState message="No priority data" />
              )}
              {/* Legend */}
              {priorityChartData.length > 0 && (
                <div className="flex flex-wrap gap-3 mt-2 justify-center">
                  {priorityChartData.map((d) => (
                    <div key={d.name} className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: d.fill }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {d.name} ({d.value})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- Object Progress ---- */}
        {explorerData.objects.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-4">
            <SectionHeader>Object Progress</SectionHeader>
            <div className="space-y-3">
              {explorerData.objects.map((obj) => {
                const objElements = getObjectElements(obj);
                const done = objElements.filter(
                  (e) => e.status === 'done'
                ).length;
                const objTotal = objElements.length;
                const pct =
                  objTotal > 0 ? Math.round((done / objTotal) * 100) : 0;

                return (
                  <div
                    key={obj.id}
                    className="grid grid-cols-[1fr_auto] gap-4 items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-foreground truncate">
                          {obj.name}
                        </span>
                        <span className="text-xs text-muted-foreground ml-2 shrink-0">
                          {done}/{objTotal}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor:
                              pct === 100
                                ? SEMANTIC_COLORS.status.done
                                : SEMANTIC_COLORS.accent,
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ---- Overdue & Upcoming ---- */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Overdue */}
          <div className="bg-card rounded-xl border border-border p-4">
            <SectionHeader>Overdue</SectionHeader>
            {overdueElements.length > 0 ? (
              <div className="space-y-1">
                {overdueElements.map((el) => (
                  <ElementRow
                    key={el.id}
                    el={el}
                    accentColor={SEMANTIC_COLORS.status.blocked}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No overdue items" />
            )}
          </div>

          {/* Upcoming 7 days */}
          <div className="bg-card rounded-xl border border-border p-4">
            <SectionHeader>Upcoming 7 Days</SectionHeader>
            {upcomingElements.length > 0 ? (
              <div className="space-y-1">
                {upcomingElements.map((el) => (
                  <ElementRow
                    key={el.id}
                    el={el}
                    accentColor={SEMANTIC_COLORS.status.in_progress}
                  />
                ))}
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
