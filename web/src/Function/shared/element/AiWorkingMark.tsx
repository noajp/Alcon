'use client';

import { Loader2 } from '@/ui/icons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { formatRemaining, type LiveLease } from './lease';

/**
 * An AI working on an Element in the background — a run in Clayware, or an
 * agent session holding its lease — shown as a small spinner beside its
 * assignees. Who holds it, on which branch and for how long are in its
 * title.
 */
export function AiWorkingMark({ lease, size = 12 }: { lease?: LiveLease | null; size?: number }) {
  const { t } = useI18n();
  const title = lease
    ? (lease.branch
      ? t('Held by {holder} on {branch} · {time} left', { holder: lease.holder, branch: lease.branch, time: formatRemaining(lease.remainingMs) })
      : t('Held by {holder} · {time} left', { holder: lease.holder, time: formatRemaining(lease.remainingMs) }))
    : t('AI is working on this');
  return (
    <span role="status" title={title} aria-label={title} className="inline-flex shrink-0 items-center text-muted-foreground">
      <Loader2 size={size} className="animate-spin" aria-hidden="true" />
    </span>
  );
}
