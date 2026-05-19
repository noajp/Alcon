'use client';

import { Check } from 'lucide-react';
import type { CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';

function clampProgress(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace('%', '').trim());
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, Math.round(parsed)));
  }
  return null;
}

function getCustomProgress(elementId: string, customColumns?: CustomColumnWithValues[]): number | null {
  const progressColumn = customColumns?.find((column) => {
    const name = column.name.trim().toLowerCase();
    return column.column_type === 'progress' || name === 'progress' || name === '進捗' || name === '進捗率';
  });
  if (!progressColumn) return null;
  return clampProgress(progressColumn.values?.[elementId]?.value);
}

export function getElementProgress(
  element: ElementWithDetails,
  customColumns?: CustomColumnWithValues[],
): number {
  const customProgress = getCustomProgress(element.id, customColumns);
  if (customProgress !== null) return customProgress;

  const subelements = element.subelements ?? [];
  if (subelements.length > 0) {
    const completed = subelements.filter((sub) => !!sub.is_completed).length;
    return Math.round((completed / subelements.length) * 100);
  }

  return element.status === 'done' ? 100 : 0;
}

// Linear-style mark: a fixed outer track ring + an inner pie that sweeps
// clockwise from 12 o'clock as progress climbs (so 50% = right half filled).
// The "pie" is rendered as a circle whose stroke is so thick the inner hole
// closes — strokeDashoffset reveals the wedge.
// Colour shifts amber → emerald → indigo, white check at 100%, outer ring
// dashed for backlog. CSS-variable colours via inline style so they resolve
// inside <svg>.
function progressTone(pct: number): string {
  if (pct >= 100) return 'var(--accent-default)';     // indigo — done
  if (pct >= 50)  return 'var(--status-success)';     // emerald — mostly done
  return 'var(--status-warning)';                      // amber — started
}

export function ElementProgressMark({
  progress,
  size = 16,
  state,
}: {
  progress: number;
  size?: number;
  /** 'backlog' renders the outer track as dashed (no work scheduled yet). */
  state?: 'backlog' | null;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const isComplete = pct >= 100;
  const isBacklog = state === 'backlog';
  const tone = progressTone(pct);

  const center = size / 2;
  const outerRadius = (size - 1.5) / 2;
  // Pie fills the inside of the ring with a small breathing gap.
  const pieOuter = outerRadius - 1.5;
  const pieStrokeR = pieOuter / 2;           // stroke centerline
  const pieStrokeW = pieOuter;               // stroke spans 0 → pieOuter
  const pieCircum = 2 * Math.PI * pieStrokeR;
  const pieDashOffset = pieCircum * (1 - pct / 100);

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/40 transition-colors group-hover:text-muted-foreground/70"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        {/* Outer track ring — always visible; dashed for backlog. */}
        <circle
          cx={center}
          cy={center}
          r={outerRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeDasharray={isBacklog ? '2 2' : undefined}
        />
        {/* Inner pie sweep — starts at 12 o'clock, sweeps clockwise. */}
        {pct > 0 && (
          <circle
            cx={center}
            cy={center}
            r={pieStrokeR}
            fill="none"
            strokeWidth={pieStrokeW}
            strokeLinecap="butt"
            strokeDasharray={pieCircum}
            strokeDashoffset={pieDashOffset}
            transform={`rotate(-90 ${center} ${center})`}
            style={{ stroke: tone, transition: 'stroke-dashoffset 260ms ease, stroke 260ms ease' }}
          />
        )}
      </svg>
      {isComplete && (
        <Check size={Math.max(9, size - 6)} strokeWidth={3} className="relative text-white" />
      )}
    </span>
  );
}
