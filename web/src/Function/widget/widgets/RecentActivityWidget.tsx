'use client';

import { useMemo } from 'react';
import { SEMANTIC_COLORS, STATUS } from '@/shared/designTokens';
import { useI18n } from '@/Function/i18n/I18nProvider';
import type { ElementWithDetails } from '@/types/database';
import { parseDateOnly } from '@/Function/shared/dateUtils';

interface Props {
  elements: ElementWithDetails[];
}

interface ActivityEntry {
  id: string;
  kind: 'created' | 'updated' | 'completed';
  element: ElementWithDetails;
  date: Date;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400], ['month', 30 * 86_400], ['week', 7 * 86_400],
  ['day', 86_400], ['hour', 3_600], ['minute', 60],
];

/** "3 days ago" in the viewer's language. */
function relativeTime(date: Date, locale: string): string {
  const seconds = (date.getTime() - Date.now()) / 1000;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}

const KIND_LABEL: Record<ActivityEntry['kind'], string> = {
  completed: 'Completed',
  created: 'Created',
  updated: 'Updated',
};

export function RecentActivityWidget({ elements }: Props) {
  const { t, locale } = useI18n();
  const activities = useMemo<ActivityEntry[]>(() => {
    const entries: ActivityEntry[] = [];
    for (const el of elements) {
      // Done elements with a recent due_date count as 'completed'
      const due = el.status === 'done' ? parseDateOnly(el.due_date) : undefined;
      if (due) {
        entries.push({
          id: `${el.id}-done`,
          kind: 'completed',
          element: el,
          date: due,
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
    return <p className="py-1 text-sm text-muted-foreground">{t('No recent activity.')}</p>;
  }

  // One line per Element: what happened, which Element, then its status and
  // when, as quiet text. The status dot keeps the shared status palette.
  return (
    <div className="max-h-[280px] overflow-y-auto">
      {activities.map((a) => {
        const statusMeta = STATUS[a.element.status as keyof typeof STATUS];
        const statusColor =
          SEMANTIC_COLORS.status[a.element.status as keyof typeof SEMANTIC_COLORS.status] ||
          SEMANTIC_COLORS.status.todo;
        return (
          <div key={a.id} className="py-1.5">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <span className="shrink-0 text-[12px] text-muted-foreground">{t(KIND_LABEL[a.kind])}</span>
              <span className="truncate text-[13px] text-foreground">{a.element.title}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                {statusMeta ? t(statusMeta.label) : a.element.status}
              </span>
              <span>{relativeTime(a.date, locale)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
