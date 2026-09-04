'use client';
import { useDashboardData } from '@/hooks/useDashboardData';
import { formatElementDate, isOverdue, daysOverdue } from '@/alcon/shared/dateUtils';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

function ElementRow({ el, accentColor }: { el: ElementWithDetails; accentColor: string }) {
  const statusMeta = STATUS[el.status as keyof typeof STATUS];
  const overdue = isOverdue(el.due_date, el.status === 'done');
  const overdueDays = overdue ? daysOverdue(el.due_date) : 0;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors"
      style={{ borderLeft: `3px solid ${accentColor}` }}>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground truncate">{el.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {statusMeta && <span className={`text-[11px] ${statusMeta.textColor}`}>{statusMeta.label}</span>}
          {el.due_date && (
            <span className={`text-[11px] ${overdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
              {overdue ? `${overdueDays}d overdue` : formatElementDate(el.due_date)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function UpcomingWidget({ elements }: { elements: ElementWithDetails[] }) {
  const { upcomingElements } = useDashboardData(elements);
  if (upcomingElements.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">Nothing due this week</div>;
  return (
    <div className="space-y-0.5 max-h-[300px] overflow-y-auto -mx-2">
      {upcomingElements.slice(0, 10).map(el => <ElementRow key={el.id} el={el} accentColor={SEMANTIC_COLORS.status.in_progress} />)}
      {upcomingElements.length > 10 && <p className="text-xs text-muted-foreground text-center pt-2">+{upcomingElements.length - 10} more</p>}
    </div>
  );
}
