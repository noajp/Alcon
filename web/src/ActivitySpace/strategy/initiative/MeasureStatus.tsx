'use client';

import { measureSummary, measureTallyDetail, type MeasureSummaryTone, type MeasureTally } from './initiativeMeasureModel';

const TONE: Record<MeasureSummaryTone, string> = {
  none: 'text-muted-foreground/60',
  missed: 'text-[var(--status-danger)]',
  open: 'text-[var(--status-warning)]',
  met: 'text-muted-foreground',
};

/** Where a Strategy (or a group of Strategies) stands against its
 *  success conditions, for a list row. Renders nothing until loaded. */
export function MeasureStatus({ tally, className = '' }: { tally: MeasureTally | undefined | null; className?: string }) {
  if (!tally) return null;
  const { text, tone } = measureSummary(tally);
  return (
    <span className={`shrink-0 whitespace-nowrap tabular-nums ${TONE[tone]} ${className}`} title={measureTallyDetail(tally) || text}>
      {text}
    </span>
  );
}
