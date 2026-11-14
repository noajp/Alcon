import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { elapsedShare, outlook, warmthGradient } from '@/Function/shared/pace';
import { ProgressBelt } from '@/Function/shared/ProgressBelt';
import { useI18n } from '@/Function/i18n/I18nProvider';

// A belt's width, px. The gradient is drawn in px, so the belt is that wide.
const WIDTH = 80;

/**
 * Health as the Timeline's belt: the schedule from its start to its due date,
 * clear where it starts and, to where today falls, a pale blue when the work
 * keeps pace and red when it trails. Without a start and a due date there is no
 * schedule to lay out, and it is the progress belt; so it is once the work is
 * all done.
 */
export function HealthBelt({ progress, start, due, className = '' }: {
  progress: number;
  start: string | null | undefined;
  due: string | null | undefined;
  className?: string;
}) {
  const { t } = useI18n();
  const today = toDateOnlyString(new Date());
  const elapsed = elapsedShare(start, due, today);
  if (elapsed === null || progress >= 100) {
    return <ProgressBelt value={progress} outlook={outlook(progress, start, due, today)} className={`shrink-0 ${className}`} style={{ width: WIDTH }} />;
  }
  const pace = outlook(progress, start, due, today);
  const gradient = warmthGradient(WIDTH, elapsed * WIDTH, pace);
  // The belt draws time, not progress: its length is how much of the schedule
  // has gone by, its warmth whether the work keeps up. Said in words for
  // anyone who cannot read that from the colour.
  const said = t('{elapsed}% of the schedule has passed; {progress}% done', { elapsed: Math.round(elapsed * 100), progress: Math.round(progress) })
    + (pace < 0 ? ` — ${t('Behind schedule')}` : '');
  return (
    <div role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={said} title={said}
      className={`relative h-2.5 shrink-0 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-foreground/[0.07] ${className}`}
      style={{ width: WIDTH }}>
      {gradient && <div className="absolute inset-0 rounded-[inherit]" style={{ backgroundImage: gradient }} />}
    </div>
  );
}
