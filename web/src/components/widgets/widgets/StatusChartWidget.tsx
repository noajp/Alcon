'use client';
import { useDashboardData } from '@/hooks/useDashboardData';
import type { ElementWithDetails } from '@/types/database';

interface Props { elements: ElementWithDetails[]; }

export function StatusChartWidget({ elements }: Props) {
  const { total, statusChartData } = useDashboardData(elements);
  if (statusChartData.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No data</div>;
  return (
    <div className="space-y-2.5 mt-1">
      {statusChartData.map(item => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        return (
          <div key={item.name} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-20 shrink-0 text-right">{item.name}</span>
            <div className="flex-1 h-4 bg-muted/40 rounded-md overflow-hidden relative">
              <div className="h-full rounded-md transition-all duration-500"
                style={{ width: `${Math.max(pct, item.value > 0 ? 3 : 0)}%`, backgroundColor: item.fill }} />
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium text-foreground/70 tabular-nums">{item.value}</span>
            </div>
            <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}
