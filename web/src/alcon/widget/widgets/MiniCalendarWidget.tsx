'use client';
import { useMemo } from 'react';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, format, isToday } from 'date-fns';
import { SEMANTIC_COLORS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

export function MiniCalendarWidget({ elements }: { elements: ElementWithDetails[] }) {
  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const start = startOfWeek(monthStart);
  const end = endOfWeek(monthEnd);
  const days = useMemo(() => eachDayOfInterval({ start, end }), [start, end]);

  const elementsByDay = useMemo(() => {
    const map = new Map<string, ElementWithDetails[]>();
    for (const el of elements) {
      if (!el.due_date) continue;
      const key = format(new Date(el.due_date), 'yyyy-MM-dd');
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(el);
    }
    return map;
  }, [elements]);

  return (
    <div>
      <div className="text-[12px] font-medium text-foreground mb-2">{format(today, 'MMMM yyyy')}</div>
      <div className="grid grid-cols-7 gap-1">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} className="text-[10px] text-center text-muted-foreground py-1">{d}</div>
        ))}
        {days.map(day => {
          const inMonth = isSameMonth(day, today);
          const today_ = isToday(day);
          const dayElements = elementsByDay.get(format(day, 'yyyy-MM-dd')) || [];
          return (
            <div key={day.toISOString()} className={`aspect-square flex flex-col items-center justify-start text-[11px] rounded p-0.5 ${
              today_ ? 'bg-foreground text-background font-medium' :
              inMonth ? 'text-foreground hover:bg-muted/40' : 'text-muted-foreground/40'}`}>
              <span>{day.getDate()}</span>
              {dayElements.length > 0 && (
                <div className="flex gap-0.5 mt-auto">
                  {dayElements.slice(0, 3).map(el => (
                    <span key={el.id} className="w-1 h-1 rounded-full"
                      style={{ backgroundColor: SEMANTIC_COLORS.status[el.status as keyof typeof SEMANTIC_COLORS.status] || SEMANTIC_COLORS.status.todo }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
