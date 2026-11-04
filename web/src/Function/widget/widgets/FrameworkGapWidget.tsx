'use client';

import { InitiativeMeasureEditor } from './InitiativeMeasureEditor';
import { useMemo } from 'react';
import { useInitiativeIntentContext } from '@/ActivitySpace/strategy/initiative/InitiativeIntent';
import { isMeasure } from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';
import {
  formatMeasureValue,
  measureStateLabel,
  targetLabel,
} from '@/ActivitySpace/strategy/initiative/initiativeMeasureModel';
import { useWidgetEmpty, useWidgetMeta } from '../WidgetFrame';
import { gapRows, toMeasureInput, type GapRow } from './strategyFrameworkModel';
import { useI18n } from '@/Function/i18n/I18nProvider';

// =============================================================
// Gap Analysis — the distance between the reading and the condition.
//
// The Strategy used to hold this as three free-text boxes in localStorage:
// Goal, Gap, Current State. Every one of them was a sentence somebody typed
// beside numbers that already said the same thing, and neither could correct
// the other. Here Goal is the measure's target, Current is its reading, and
// the Gap is drawn — one track per condition, in that condition's own unit.
//
// The tracks are deliberately not comparable to each other. Each is scaled to
// its own numbers, because nine points of hand hygiene and three unclosed
// corrections are not on one scale and a shared axis would claim they were.
// =============================================================

/** Takes no host: the Strategy it reads is the one whose Intent bundle the
 *  surface mounted, and asking for the subject as well would give it two
 *  sources for the same answer. */
export function FrameworkGapWidget() {
  // Read through the surface's shared Intent bundle rather than fetching
  // again. The Measures section sits directly above this one and refetches
  // that bundle after every write, so a reading recorded there lands here on
  // the same pass; a private fetch would leave the two disagreeing until the
  // page remounted.
  const { t } = useI18n();
  const initiative = useInitiativeIntentContext();
  const error = initiative?.error ?? null;
  const loading = initiative ? initiative.data === null && error === null : true;

  const rows = useMemo(
    () =>
      gapRows(
        (initiative?.data?.subs ?? []).filter((i) => isMeasure(i.kind)).map(toMeasureInput),
      ),
    [initiative?.data?.subs],
  );
  const open = rows.filter((r) => r.state === 'missed').length;

  useWidgetMeta(rows.length === 0 ? null : open > 0 ? t('{n} short', { n: open }) : t('{n} tracked', { n: rows.length }));
  useWidgetEmpty(!error && loading);

  if (error) {
    return (
      <p className="py-1 text-[12px] text-[var(--status-danger)]">
        {t('Could not read this Strategy’s conditions.')}
      </p>
    );
  }
  if (!initiative) return null;

  return (
    <div className="py-1">
      <InitiativeMeasureEditor initiativeId={initiative.initiativeId} initiativeName={initiative.data?.master?.title ?? t('Strategy')}>
      {rows.map((row) => (
        <GapTrack key={row.id} row={row} />
      ))}
      </InitiativeMeasureEditor>
    </div>
  );
}

function GapTrack({ row }: { row: GapRow }) {
  const { t } = useI18n();
  const target = targetLabel(row);
  const reading = formatMeasureValue(row.actual, row.unit);
  const judged = row.state === 'met' || row.state === 'missed';

  return (
    <div className="py-2 space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">{row.title}</span>
        {!judged && (
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {t(measureStateLabel(row.state))}
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
        {reading && <span>{t('Now {value}', { value: reading })}</span>}
        {target && <span>{reading ? '· ' : ''}{t('Goal {value}', { value: target })}</span>}
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
