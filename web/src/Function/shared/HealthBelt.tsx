import { toDateOnlyString } from '@/Function/shared/dateUtils';
import { elapsedShare, outlook, warmthGradient } from '@/Function/shared/pace';
import { ProgressBelt } from '@/Function/shared/ProgressBelt';

// A belt's width, px. The gradient is drawn in px, so the belt is that wide.
const WIDTH = 112;

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
  const today = toDateOnlyString(new Date());
  const elapsed = elapsedShare(start, due, today);
  if (elapsed === null || progress >= 100) {
    return <ProgressBelt value={progress} outlook={outlook(progress, start, due, today)} className={className} />;
  }
  const gradient = warmthGradient(WIDTH, elapsed * WIDTH, outlook(progress, start, due, today));
  return (
    <div role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}
      className={`relative h-2.5 shrink-0 overflow-hidden rounded-md border border-[var(--border-subtle)] bg-foreground/[0.07] ${className}`}
      style={{ width: WIDTH }}>
      {gradient && <div className="absolute inset-0 rounded-[inherit]" style={{ backgroundImage: gradient }} />}
    </div>
  );
}
