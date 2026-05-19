'use client';

import { Send, X, Slash, Check } from 'lucide-react';
import type { CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';
import type { ElementStatus } from '@/types/database';

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
  // Manual override from the status picker — highest precedence.
  if (typeof element.progress === 'number') {
    return Math.max(0, Math.min(100, Math.round(element.progress)));
  }

  const customProgress = getCustomProgress(element.id, customColumns);
  if (customProgress !== null) return customProgress;

  const subelements = element.subelements ?? [];
  if (subelements.length > 0) {
    const completed = subelements.filter((sub) => !!sub.is_completed).length;
    return Math.round((completed / subelements.length) * 100);
  }

  return element.status === 'done' ? 100 : 0;
}

// Status-driven mark — every status renders the same outer ○ with its
// status content placed inside, so the visual stays anchored to the ring.
//   backlog     → dashed ring, empty
//   todo / null → solid ring, empty
//   in_progress → solid ring + amber pie sweep at progress%
//   review      → solid ring + paper-plane glyph
//   done        → solid ring + green inner disc
//   blocked     → matte-red ring + matte-red disc + white ×
//   cancelled   → solid ring + Slash glyph
export function ElementProgressMark({
  status,
  progress = 0,
  size = 16,
}: {
  status?: ElementStatus | null;
  progress?: number;
  size?: number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  const center = size / 2;
  const ringStrokeWidth = 1.8;
  const outerRadius = (size - 2) / 2;
  const pieOuter = outerRadius - 1.5;
  const pieStrokeR = pieOuter / 2;
  const pieStrokeW = pieOuter;
  const pieCircum = 2 * Math.PI * pieStrokeR;
  const pieDashOffset = pieCircum * (1 - pct / 100);
  const glyphSize = Math.max(8, Math.round(size * 0.6));

  // ── Blocked — matte red ring + lighter red disc + white × ───────────
  if (status === 'blocked') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full text-rose-700/90"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle
            cx={center}
            cy={center}
            r={outerRadius}
            fill="none"
            stroke="currentColor"
            strokeWidth={ringStrokeWidth}
          />
          <circle cx={center} cy={center} r={pieOuter} className="fill-rose-500/85" />
        </svg>
        <X size={Math.max(7, size - 9)} strokeWidth={3} className="relative text-white" />
      </span>
    );
  }

  // ── Done — solid green disc + white check (no outer ring) ───────────
  if (status === 'done') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle cx={center} cy={center} r={outerRadius} style={{ fill: 'var(--status-success)' }} />
        </svg>
        <Check size={glyphSize} strokeWidth={3} className="relative text-white" />
      </span>
    );
  }

  // ── Review — solid blue disc + white paper plane (no outer ring) ────
  if (status === 'review') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle cx={center} cy={center} r={outerRadius} className="fill-blue-500" />
        </svg>
        <Send size={glyphSize} strokeWidth={2.5} className="relative text-white" />
      </span>
    );
  }

  // ── Cancelled — solid ring + slash glyph ─────────────────────────────
  if (status === 'cancelled') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/40"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle
            cx={center}
            cy={center}
            r={outerRadius}
            fill="none"
            stroke="currentColor"
            strokeWidth={ringStrokeWidth}
          />
        </svg>
        <Slash size={glyphSize} strokeWidth={2.5} className="relative text-muted-foreground" />
      </span>
    );
  }

  // ── Backlog / Todo / In Progress ─────────────────────────────────────
  const isBacklog = status === 'backlog';
  const isInProgress = status === 'in_progress';

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/40"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <circle
          cx={center}
          cy={center}
          r={outerRadius}
          fill="none"
          stroke="currentColor"
          strokeWidth={ringStrokeWidth}
          strokeDasharray={isBacklog ? '2 2' : undefined}
        />
        {isInProgress && pct > 0 && (
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
            style={{ stroke: 'var(--status-warning)', transition: 'stroke-dashoffset 260ms ease' }}
          />
        )}
      </svg>
    </span>
  );
}
