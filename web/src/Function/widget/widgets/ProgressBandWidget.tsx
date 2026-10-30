'use client';

import { useMemo } from 'react';
import { SegmentedProgress } from '@/Function/shared/SegmentedProgress';
import type { WidgetHost } from '../types';
import { completionOf, isOpenStatus } from '@/Function/shared/completion';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { isOverdue } from '@/Function/shared/dateUtils';

/**
 * The band. One line above everything else: how much of this subject is done,
 * and what is still open.
 *
 * Subject-agnostic on purpose — it counts the Elements the host resolved, so
 * the same widget answers for an Object, a Initiative, a Phase or the Space
 * without knowing which of those it is looking at.
 */
export function ProgressBandWidget({ host }: { host: WidgetHost }) {
  const { t } = useI18n();
  const stats = useMemo(() => {
    const { done, total, pct } = completionOf(host.elements);
    const inProgress = host.elements.filter((e) => e.status === 'in_progress').length;
    const overdue = host.elements.filter((e) => isOpenStatus(e.status) && isOverdue(e.due_date)).length;
    return { total, done, inProgress, overdue, pct };
  }, [host.elements]);

  return (
    <div className="flex items-center gap-3">
      <SegmentedProgress value={stats.pct} className="w-40 min-w-12 shrink" />
      <span className="shrink-0 text-[12px] font-medium tabular-nums text-foreground">{stats.pct}%</span>
      <span className="min-w-0 truncate text-[12px] tabular-nums text-muted-foreground">
        {t('{done}/{total} done', { done: stats.done, total: stats.total })}
        {stats.inProgress > 0 && <span className="ml-1.5">· {t('{n} active', { n: stats.inProgress })}</span>}
        {stats.overdue > 0 && <span className="ml-1.5 text-[var(--status-danger)]">· {t('{n} overdue', { n: stats.overdue })}</span>}
      </span>
    </div>
  );
}
