'use client';

import { MessageIcon } from '@/Function/shared/conceptIcons';
import { formatRelative } from '@/Function/shared/dateUtils';
import type { ElementCommentActivity } from '@/types/database';
import { useI18n } from '@/Function/i18n/I18nProvider';

/** Comment count, in the quiet register the list rows established: a signal,
 *  not a status. How recently the thread moved is in the tooltip — a detail
 *  of the thread, not something every row should carry. One component so the
 *  list row, the Activity column and the Board card cannot drift apart in what
 *  "active" looks like. Renders nothing when the Element has no comments. */
export function ActivitySignal({
  activity,
  className = '',
}: {
  activity: ElementCommentActivity | undefined;
  className?: string;
}) {
  const { t } = useI18n();
  if (!activity) return null;
  const relative = formatRelative(activity.lastCommentAt);
  return (
    <span
      className={`shrink-0 flex items-center gap-1.5 text-[11px] text-muted-foreground/70 ${className}`}
      title={`${t(activity.commentCount === 1 ? '{n} comment' : '{n} comments', { n: activity.commentCount })} · ${relative}`}
    >
      <MessageIcon size={12} />
      <span className="tabular-nums">{activity.commentCount}</span>
    </span>
  );
}
