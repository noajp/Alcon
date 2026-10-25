'use client';
import { useDashboardData } from '@/hooks/useDashboardData';
import { isOverdue, daysOverdue, parseDateOnly } from '@/Function/shared/dateUtils';
import { ContentRow } from '@/Function/shared/ContentRow';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { STATUS } from '@/shared/designTokens';
import type { ElementWithDetails } from '@/types/database';

function ElementRow({ el }: { el: ElementWithDetails }) {
  const { t, locale } = useI18n();
  const statusMeta = STATUS[el.status as keyof typeof STATUS];
  const overdue = isOverdue(el.due_date, el.status === 'done');
  const due = parseDateOnly(el.due_date);
  // A flat row: the title, then its state and date as quiet figures. Only a
  // date that has already passed turns red.
  return (
    <ContentRow name={el.title} meta={<>
      {statusMeta && <span>{t(statusMeta.label)}</span>}
      {due && (overdue
        ? <span className="text-[var(--status-danger)]">{t('{n}d overdue', { n: daysOverdue(el.due_date) })}</span>
        : <span>{due.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}</span>)}
    </>} />
  );
}

export function OverdueWidget({ elements }: { elements: ElementWithDetails[] }) {
  const { t } = useI18n();
  const { overdueElements } = useDashboardData(elements);
  if (overdueElements.length === 0) return <p className="py-1 text-sm text-muted-foreground">{t('No overdue Elements.')}</p>;
  return (
    <div className="max-h-[300px] overflow-y-auto -mx-2">
      {overdueElements.slice(0, 10).map(el => <ElementRow key={el.id} el={el} />)}
      {overdueElements.length > 10 && <p className="px-2 pt-1 text-xs text-muted-foreground">{t('+{n} more', { n: overdueElements.length - 10 })}</p>}
    </div>
  );
}
