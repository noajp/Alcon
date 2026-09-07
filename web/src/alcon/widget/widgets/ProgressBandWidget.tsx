'use client';

import { useMemo } from 'react';
import { SegmentedProgress } from '@/alcon/shared/SegmentedProgress';
import type { WidgetHost } from '../types';
import { completionOf } from '@/alcon/shared/completion';

/**
 * The band. One line above everything else: how much of this subject is done,
 * and what is still open.
 *
 * Subject-agnostic on purpose — it counts the Elements the host resolved, so
 * the same widget answers for an Object, a Initiative, a Phase or the Space
 * without knowing which of those it is looking at.
 */
export function ProgressBandWidget({ host }: { host: WidgetHost }) {
  const stats = useMemo(() => {
    const { done, total, pct } = completionOf(host.elements);
    const inProgress = host.elements.filter((e) => e.status === 'in_progress').length;
    const overdue = host.elements.filter((e) => {
      if (!e.due_date || e.status === 'done') return false;
      return new Date(e.due_date) < new Date();
    }).length;
    return { total, done, inProgress, overdue, pct };
  }, [host.elements]);

  return (
    <div className="flex items-center gap-3">
      <SegmentedProgress value={stats.pct} className="flex-1 min-w-0" />
      <span className="shrink-0 text-[11px] tabular-nums text-foreground/80">{stats.pct}%</span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {stats.done}/{stats.total} done
        {stats.inProgress > 0 && <span className="ml-1.5 text-[var(--status-warning)]">· {stats.inProgress} active</span>}
        {stats.overdue > 0 && <span className="ml-1.5 text-[var(--status-danger)]">· {stats.overdue} overdue</span>}
      </span>
    </div>
  );
}
