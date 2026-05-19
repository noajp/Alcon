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

// Linear-style two-circle mark: a fixed outer track ring + an inner disc
// that grows from 0 → outer-radius as progress climbs. Colour shifts
// amber → emerald → indigo, with a check at 100%. Dashed track when
// state="backlog". CSS-variable colours are set via inline style so they
// resolve inside <svg>.
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
  // The inner disc tops out just inside the ring so the two circles read
  // as distinct even at 100%.
  const innerMax = outerRadius - 1.5;
  const innerRadius = (pct / 100) * innerMax;

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
        {/* Inner disc — concentric circle that grows with progress. */}
        {pct > 0 && (
          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            style={{ fill: tone, transition: 'r 260ms ease, fill 260ms ease' }}
          />
        )}
      </svg>
      {isComplete && (
        <Check size={Math.max(9, size - 6)} strokeWidth={3} className="relative text-white" />
      )}
    </span>
  );
}
