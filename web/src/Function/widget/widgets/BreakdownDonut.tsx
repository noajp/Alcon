'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import type { Tallied } from '@/Function/shared/dimensions';

// Split from BreakdownWidget so recharts is behind its own dynamic import:
// the bar shape is the default and must not pay ~400KB for a chart it does
// not draw. `'use client'` is required — recharts does not render on the
// server (CLAUDE.md).

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
    <div className="rounded-xl border border-border/60 bg-popover px-3 py-2 shadow-lg">
      <p className="text-[11px] text-muted-foreground">{d.name}</p>
      <p className="text-lg font-semibold tabular-nums text-foreground">
        {d.value}
      </p>
    </div>
  );
}

export function BreakdownDonut({ rows, total }: { rows: Tallied[]; total: number }) {
  // A dimension with no palette of its own (Assignee, Label, Object) gets one
  // neutral fill for every slice: the ring still shows the proportions, and
  // inventing colours would attach meaning to values that carry none. The
  // legend beside it is what tells the slices apart.
  const data = rows.map((r) => ({
    name: r.label,
    value: r.value,
    fill: r.color ?? 'var(--border-strong)',
  }));

  return (
    <div className="flex items-center gap-6">
      <div className="h-[140px] w-[140px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={42}
              outerRadius={66}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {data.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <div key={d.name} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: d.fill }}
              />
              <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{d.name}</span>
              <span className="text-[13px] tabular-nums text-foreground">{d.value}</span>
              <span className="w-8 text-right text-[11px] tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
