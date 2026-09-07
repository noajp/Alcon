'use client';

import { MessageIcon } from '@/alcon/shared/conceptIcons';
import { formatRelative } from '@/alcon/shared/dateUtils';
import type { ElementCommentActivity } from '@/types/database';

/** Comment count + how recently the thread moved, in the quiet register the
 *  list rows established: a signal, not a status. One component so the list
 *  row, the Activity column and the Board card cannot drift apart in what
 *  "active" looks like. Renders nothing when the Element has no comments. */
export function ActivitySignal({
  activity,
  showRelative = true,
  className = '',
}: {
  activity: ElementCommentActivity | undefined;
  /** Off where space is tight (a Board card footer) — the count alone still
   *  separates a discussed Element from a silent one, and the tooltip keeps
   *  the timing. */
  showRelative?: boolean;
  className?: string;
}) {
  if (!activity) return null;
  const relative = formatRelative(activity.lastCommentAt);
  return (
    <span
      className={`shrink-0 flex items-center gap-1 text-[11px] text-muted-foreground/70 ${className}`}
      title={`${activity.commentCount} comment${activity.commentCount === 1 ? '' : 's'} · ${relative}`}
    >
      <MessageIcon size={12} />
      <span className="tabular-nums">{activity.commentCount}</span>
      {showRelative && <span className="text-muted-foreground/50">{relative}</span>}
    </span>
  );
}
