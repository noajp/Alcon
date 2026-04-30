'use client';
import { useMemo } from 'react';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

export function MiniGanttWidget({ elements }: { elements: ElementWithDetails[] }) {
  const elementsWithDates = useMemo(
    () => elements.filter(e => e.start_date && e.due_date).slice(0, 12),
    [elements]
  );

  const dateRange = useMemo(() => {
    if (elementsWithDates.length === 0) {
      const today = new Date();
      return { start: today, end: new Date(today.getTime() + 30 * 86400000) };
    }
    const dates = elementsWithDates.flatMap(e => [
      new Date(e.start_date!).getTime(),
      new Date(e.due_date!).getTime(),
    ]);
    const min = new Date(Math.min(...dates));
    const max = new Date(Math.max(...dates));
    min.setDate(min.getDate() - 2);
    max.setDate(max.getDate() + 2);
    return { start: min, end: max };
  }, [elementsWithDates]);

  const totalDays = Math.max(1, Math.ceil((dateRange.end.getTime() - dateRange.start.getTime()) / 86400000));
  const today = new Date();
  const todayPct = ((today.getTime() - dateRange.start.getTime()) / (dateRange.end.getTime() - dateRange.start.getTime())) * 100;

  if (elementsWithDates.length === 0) {
    return <div className="py-8 text-center text-sm text-muted-foreground">No scheduled items</div>;
  }

  return (
    <div className="space-y-1 max-h-[280px] overflow-y-auto pr-2">
      {elementsWithDates.map(el => {
        const start = new Date(el.start_date!);
        const end = new Date(el.due_date!);
        const startPct = ((start.getTime() - dateRange.start.getTime()) / (dateRange.end.getTime() - dateRange.start.getTime())) * 100;
        const widthPct = Math.max(2, ((end.getTime() - start.getTime()) / (dateRange.end.getTime() - dateRange.start.getTime())) * 100);
        const color = SEMANTIC_COLORS.status[el.status as keyof typeof SEMANTIC_COLORS.status] || SEMANTIC_COLORS.status.todo;
        return (
          <div key={el.id} className="flex items-center gap-3 group">
            <span className="text-[11px] text-muted-foreground truncate w-32 shrink-0" title={el.title}>{el.title}</span>
            <div className="flex-1 h-5 bg-muted/30 rounded relative">
              <div className="absolute h-full rounded transition-opacity hover:opacity-90"
                style={{ left: `${startPct}%`, width: `${widthPct}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}
      {/* Today line */}
      {todayPct >= 0 && todayPct <= 100 && (
        <div className="relative h-0">
          <div className="absolute" style={{ left: `calc(8rem + 12px + (100% - 8rem - 12px) * ${todayPct / 100})`, top: '-100%', height: '100%' }}>
            <div className="w-px h-full bg-red-500/50" />
          </div>
        </div>
      )}
    </div>
  );
}
