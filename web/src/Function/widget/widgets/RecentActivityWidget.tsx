'use client';

import { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, Plus, Pencil, Circle } from 'lucide-react';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

interface Props {
  elements: ElementWithDetails[];
}

interface ActivityEntry {
  id: string;
  kind: 'created' | 'updated' | 'completed';
  element: ElementWithDetails;
  date: Date;
}

export function RecentActivityWidget({ elements }: Props) {
  const activities = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    for (const el of elements) {
      // Done elements with a recent due_date count as 'completed'
      if (el.status === 'done' && el.due_date) {
        entries.push({
          id: `${el.id}-done`,
          kind: 'completed',
          element: el,
          date: new Date(el.due_date),
        });
      }
      // Treat updated_at as recent change signal
      if (el.updated_at) {
        const updatedDate = new Date(el.updated_at);
        const createdDate = el.created_at ? new Date(el.created_at) : null;
        // If updated within seconds of created, treat as creation
        const isCreation = createdDate && Math.abs(updatedDate.getTime() - createdDate.getTime()) < 5000;
        entries.push({
          id: `${el.id}-${isCreation ? 'created' : 'updated'}`,
          kind: isCreation ? 'created' : 'updated',
          element: el,
          date: updatedDate,
        });
      }
    }
    // Dedupe — keep most recent per element
    const byElement = new Map<string, ActivityEntry>();
    for (const e of entries) {
      const existing = byElement.get(e.element.id);
      if (!existing || e.date > existing.date) byElement.set(e.element.id, e);
    }
    return Array.from(byElement.values())
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 12);
  }, [elements]);

  if (activities.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No recent activity</div>;
  }

  return (
    <div className="space-y-2 max-h-[280px] overflow-y-auto -mx-2 px-2">
      {activities.map((a) => {
        const statusMeta = STATUS[a.element.status as keyof typeof STATUS];
        const statusColor =
          SEMANTIC_COLORS.status[a.element.status as keyof typeof SEMANTIC_COLORS.status] ||
          SEMANTIC_COLORS.status.todo;

        const Icon = a.kind === 'completed' ? CheckCircle2 : a.kind === 'created' ? Plus : Pencil;
        const iconColor =
          a.kind === 'completed'
            ? 'text-emerald-500'
            : a.kind === 'created'
              ? 'text-blue-500'
              : 'text-muted-foreground';

        return (
          <div key={a.id} className="flex items-start gap-3 py-1.5">
            <div className="mt-0.5 shrink-0">
              <Icon size={14} className={iconColor} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[12px] text-muted-foreground">
                  {a.kind === 'completed'
                    ? 'Completed'
                    : a.kind === 'created'
                      ? 'Created'
                      : 'Updated'}
                </span>
                <span className="text-[13px] text-foreground truncate">{a.element.title}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Circle size={6} className="fill-current" style={{ color: statusColor }} />
                  {statusMeta?.label || a.element.status}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {formatDistanceToNow(a.date, { addSuffix: true })}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
