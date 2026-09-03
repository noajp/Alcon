'use client';

import { useMemo } from 'react';
import { useCampaignMeasures } from '@/hooks/useCampaignMeasures';
import {
  formatMeasureValue,
  measureStateLabel,
  targetLabel,
} from '@/alcon/element/actions/campaignMeasureModel';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import { gapRows, toMeasureInput, type GapRow } from './strategyFrameworkModel';
import type { WidgetHost } from '../types';

// =============================================================
// Gap Analysis — the distance between the reading and the condition.
//
// The Campaign used to hold this as three free-text boxes in localStorage:
// Goal, Gap, Current State. Every one of them was a sentence somebody typed
// beside numbers that already said the same thing, and neither could correct
// the other. Here Goal is the measure's target, Current is its reading, and
// the Gap is drawn — one track per condition, in that condition's own unit.
//
// The tracks are deliberately not comparable to each other. Each is scaled to
// its own numbers, because nine points of hand hygiene and three unclosed
// corrections are not on one scale and a shared axis would claim they were.
// =============================================================

export function FrameworkGapWidget({ host }: { host: WidgetHost }) {
  const campaignId = host.subject.id ?? '';
  const ids = useMemo(() => (campaignId ? [campaignId] : []), [campaignId]);
  const { measures, loading, error } = useCampaignMeasures(ids);

  const rows = useMemo(() => gapRows(measures.map(toMeasureInput)), [measures]);
  const open = rows.filter((r) => r.state === 'missed').length;

  useWidgetMeta(rows.length === 0 ? null : open > 0 ? `${open} short` : `${rows.length} tracked`);
  useWidgetEmpty(!error && (loading || rows.length === 0));

  if (error) {
    return (
      <p className="px-3 py-2 text-[12px] text-[var(--status-danger)]">
        Could not read this Campaign&apos;s conditions.
      </p>
    );
  }
  if (rows.length === 0) return null;

  return (
    <div className="py-1">
      {rows.map((row) => (
        <GapTrack key={row.id} row={row} />
      ))}
    </div>
  );
}

function GapTrack({ row }: { row: GapRow }) {
  const target = targetLabel(row);
  const reading = formatMeasureValue(row.actual, row.unit);
  const judged = row.state === 'met' || row.state === 'missed';

  return (
    <div className="px-3 py-2 space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">{row.title}</span>
        {!judged && (
          <span className="shrink-0 text-[11px] text-[var(--status-warning)]">
            {measureStateLabel(row.state)}
          </span>
        )}
      </div>

      {/* The track. The filled part is the reading, and the END of the track is
          the goal — which is why the notch is drawn only when the reading has
          gone past it. A mark pinned to the right edge on every row that is
          short of its target carries no information; a mark the bar has run
          through is the whole finding. */}
      <div className="relative h-1.5 rounded-full bg-[var(--surface-strong)]">
        {row.actualFraction !== null && (
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${
              row.state === 'missed'
                ? 'bg-[var(--status-danger)]'
                : row.state === 'met'
                  ? 'bg-[var(--status-success)]'
                  : 'bg-[var(--border-strong)]'
            }`}
            style={{ width: `${Math.round(row.actualFraction * 100)}%` }}
          />
        )}
        {row.targetFraction !== null && row.targetFraction < 1 && (
          <div
            aria-hidden
            className="absolute inset-y-[-3px] w-px bg-[var(--text-primary)]"
            style={{ left: `${Math.round(row.targetFraction * 100)}%` }}
          />
        )}
      </div>

      <div className="flex items-baseline gap-2 text-[11px] tabular-nums text-muted-foreground">
        {/* The state chip above already says when there is no reading, so this
            line carries the goal alone rather than repeating it. */}
        {reading && <span>Now {reading}</span>}
        {target && <span>{reading ? '· ' : ''}Goal {target}</span>}
        {row.distance !== null && row.distance !== 0 && (
          <span className={row.state === 'missed' ? 'text-[var(--status-danger)]' : undefined}>
            · {row.distance > 0 ? '+' : ''}
            {formatMeasureValue(row.distance, row.unit)}
          </span>
        )}
      </div>
    </div>
  );
}
