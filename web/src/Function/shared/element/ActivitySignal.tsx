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
  unread = false,
  className = '',
}: {
  activity: ElementCommentActivity | undefined;
  /** A comment the viewer has not read yet: the mark carries a dot. */
  unread?: boolean;
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
      <span className="relative inline-flex">
        <MessageIcon size={12} />
        {unread && <UnreadDot className="-right-1 -top-1" />}
      </span>
      <span className="tabular-nums">{activity.commentCount}</span>
    </span>
  );
}

/** The mark of something new and unread, as the Inbox badge draws it. */
export function UnreadDot({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return <span role="img" aria-label={t('New comments')} className={`absolute size-1.5 rounded-full bg-[var(--accent-default)] ${className}`} />;
}
