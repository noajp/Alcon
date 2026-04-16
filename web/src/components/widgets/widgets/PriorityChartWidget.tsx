'use client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { ElementWithDetails } from '@/types/database';

interface Props { elements: ElementWithDetails[]; }

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; value: number; fill: string } }>; }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-popover border border-border/60 rounded-xl px-3 py-2 shadow-lg">
      <p className="text-[11px] text-muted-foreground">{d.name}</p>
      <p className="text-lg font-semibold tabular-nums" style={{ color: d.fill }}>{d.value}</p>
    </div>
  );
}

export function PriorityChartWidget({ elements }: Props) {
  const { total, priorityChartData } = useDashboardData(elements);
  if (priorityChartData.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No data</div>;
  return (
    <div className="flex items-center gap-6">
      <div className="w-[140px] h-[140px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={priorityChartData} cx="50%" cy="50%" innerRadius={42} outerRadius={66} paddingAngle={2} dataKey="value" stroke="none">
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
  );
}
