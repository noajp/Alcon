'use client';
import { format, differenceInDays } from 'date-fns';
import { useDashboardData } from '@/hooks/useDashboardData';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

function ElementRow({ el, accentColor }: { el: ElementWithDetails; accentColor: string }) {
  const dueDate = el.due_date ? new Date(el.due_date) : null;
  const statusMeta = STATUS[el.status as keyof typeof STATUS];
  const isOverdue = dueDate && dueDate < new Date() && el.status !== 'done';
  const daysOverdue = dueDate && isOverdue ? differenceInDays(new Date(), dueDate) : 0;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/40 transition-colors"
      style={{ borderLeft: `3px solid ${accentColor}` }}>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground truncate">{el.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {statusMeta && <span className={`text-[11px] ${statusMeta.color}`}>{statusMeta.label}</span>}
          {dueDate && (
            <span className={`text-[11px] ${isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground'}`}>
              {isOverdue ? `${daysOverdue}d overdue` : format(dueDate, 'MMM d')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function OverdueWidget({ elements }: { elements: ElementWithDetails[] }) {
  const { overdueElements } = useDashboardData(elements);
  if (overdueElements.length === 0) return <div className="py-8 text-center text-sm text-muted-foreground">No overdue items</div>;
  return (
    <div className="space-y-0.5 max-h-[300px] overflow-y-auto -mx-2">
      {overdueElements.slice(0, 10).map(el => <ElementRow key={el.id} el={el} accentColor={SEMANTIC_COLORS.status.blocked} />)}
      {overdueElements.length > 10 && <p className="text-xs text-muted-foreground text-center pt-2">+{overdueElements.length - 10} more</p>}
    </div>
  );
}
