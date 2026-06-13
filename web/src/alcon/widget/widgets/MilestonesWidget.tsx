'use client';

import { useMemo } from 'react';
import { Flag } from 'lucide-react';
import { formatElementDate, daysUntil } from '@/alcon/shared/dateUtils';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

interface Props {
  elements: ElementWithDetails[];
}

/**
 * Milestones = high-priority Elements with due dates.
 * Sorted by due date, grouped by month.
 */
export function MilestonesWidget({ elements }: Props) {
  const milestones = useMemo(() => {
    return elements
      .filter((e) => e.due_date && (e.priority === 'high' || e.priority === 'urgent'))
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
  }, [elements]);

  if (milestones.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground">
        No high-priority items with dates yet
      </div>
    );
  }

  // Group by month
  const grouped = milestones.reduce<Record<string, ElementWithDetails[]>>((acc, el) => {
    const key = formatElementDate(el.due_date!, 'monthYear')!;
    (acc[key] ||= []).push(el);
    return acc;
  }, {});

  return (
    <div className="space-y-4 max-h-[360px] overflow-y-auto -mx-2 px-2">
      {Object.entries(grouped).map(([month, items]) => (
        <div key={month}>
          <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2 sticky top-0 bg-background py-1">
            {month}
          </div>
          <div className="relative pl-5">
            <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border/60" />
            {items.map((m) => {
              const days = daysUntil(m.due_date!);
              const statusMeta = STATUS[m.status as keyof typeof STATUS];
              const isOverdue = days < 0 && m.status !== 'done';
              const isDone = m.status === 'done';
              const color =
                SEMANTIC_COLORS.status[m.status as keyof typeof SEMANTIC_COLORS.status] ||
                SEMANTIC_COLORS.status.todo;
              const isUrgent = m.priority === 'urgent';

              return (
                <div key={m.id} className="relative flex items-start gap-3 py-2">
                  <div
                    className="absolute left-[-13px] w-3 h-3 rounded-full border-2 border-background shrink-0"
                    style={{ backgroundColor: isDone ? '#10B981' : color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {isUrgent && (
                        <Flag size={10} className="text-red-500 fill-current shrink-0" />
                      )}
                      <span className="text-[13px] font-medium text-foreground truncate">
                        {m.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-muted-foreground">
                        {formatElementDate(m.due_date!)}
                      </span>
                      <span
                        className={`text-[11px] ${
                          isOverdue
                            ? 'text-red-500 font-medium'
                            : isDone
                              ? 'text-emerald-600'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {isDone
                          ? 'Done'
                          : isOverdue
                            ? `${Math.abs(days)}d overdue`
                            : days === 0
                              ? 'Today'
                              : `in ${days}d`}
                      </span>
                      {statusMeta && (
                        <span className={`text-[11px] ${statusMeta.color}`}>
                          {statusMeta.label}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
