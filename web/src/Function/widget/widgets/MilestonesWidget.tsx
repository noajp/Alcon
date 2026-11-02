'use client';

import { useMemo } from 'react';
import { Diamond } from '@/ui/icons';
import { daysUntil, parseDateOnly } from '@/Function/shared/dateUtils';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { STATUS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';
import { useWidgetEmpty } from '../WidgetFrame';

interface Props {
  elements: ElementWithDetails[];
}

/**
 * Milestones = high-priority Elements with due dates.
 * Sorted by due date, grouped by month.
 */
export function MilestonesWidget({ elements }: Props) {
  const { t, locale } = useI18n();
  const milestones = useMemo(() => {
    return elements
      .filter((e) => e.due_date && (e.priority === 'high' || e.priority === 'urgent'))
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime());
  }, [elements]);

  // Derived, not entered: with no dated high-priority Elements there is
  // nothing to show, so the frame hides the widget (it reappears in arrange
  // mode, where it can still be removed) instead of boxing an apology.
  useWidgetEmpty(milestones.length === 0);
  if (milestones.length === 0) return null;

  // Group by month
  const grouped = milestones.reduce<Record<string, ElementWithDetails[]>>((acc, el) => {
    const key = (parseDateOnly(el.due_date) ?? new Date(el.due_date!)).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    (acc[key] ||= []).push(el);
    return acc;
  }, {});

  return (
    <div className="space-y-4 max-h-[360px] overflow-y-auto">
      {Object.entries(grouped).map(([month, items]) => (
        <div key={month}>
          <div className="text-[12px] text-muted-foreground pb-1">{month}</div>
          <div>
            {items.map((m) => {
              const days = daysUntil(m.due_date!);
              const statusMeta = STATUS[m.status as keyof typeof STATUS];
              const isOverdue = days < 0 && m.status !== 'done';
              const isDone = m.status === 'done';
              const due = parseDateOnly(m.due_date) ?? new Date(m.due_date!);

              return (
                <div key={m.id} className="py-1.5">
                  <div className="flex items-center gap-2">
                    <Diamond size={12} className="shrink-0 text-muted-foreground" />
                    <span className="text-[13px] font-medium text-foreground truncate">{m.title}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 pl-5 text-[12px] text-muted-foreground">
                    <span>{due.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>
                    {/* Only a milestone already missed asks for action, so only it is red. */}
                    <span className={isOverdue ? 'text-[var(--status-danger)]' : undefined}>
                      {isDone
                        ? t('Done')
                        : isOverdue
                          ? t('{n}d overdue', { n: Math.abs(days) })
                          : days === 0
                            ? t('Today')
                            : t('in {n}d', { n: days })}
                    </span>
                    {statusMeta && !isDone && <span>{t(statusMeta.label)}</span>}
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
