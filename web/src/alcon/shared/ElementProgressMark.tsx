'use client';

import { Send, X, Ban } from 'lucide-react';
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

// Status-driven mark — visual is determined by element.status, with the
// in-progress sweep size driven by `progress`. Colours come from design
// tokens via inline style so CSS vars resolve inside <svg>.
//   backlog     → dashed outer ring
//   todo / null → solid outer ring (no fill)
//   in_progress → solid outer ring + amber pie sweep at progress%
//   review      → paper-plane glyph (no ring)
//   done        → solid green disc (full)
//   blocked     → red ring + red disc + white ×
//   cancelled   → Ban glyph
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

  // ── Review — paper plane glyph, no ring ────────────────────────────
  if (status === 'review') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center text-blue-400"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Send size={Math.max(11, size - 4)} strokeWidth={2} />
      </span>
    );
  }

  // ── Cancelled — Ban glyph ─────────────────────────────────────────
  if (status === 'cancelled') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center text-muted-foreground"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Ban size={size} strokeWidth={2} />
      </span>
    );
  }

  // ── Blocked — red ring + red fill + white × ──────────────────────
  if (status === 'blocked') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle
            cx={center}
            cy={center}
            r={outerRadius}
            strokeWidth={ringStrokeWidth}
            style={{ fill: 'var(--status-danger)', stroke: 'var(--status-danger)' }}
          />
        </svg>
        <X size={Math.max(9, size - 6)} strokeWidth={3} className="relative text-white" />
      </span>
    );
  }

  // ── Done — solid green disc ───────────────────────────────────────
  if (status === 'done') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle
            cx={center}
            cy={center}
            r={outerRadius}
            style={{ fill: 'var(--status-success)' }}
          />
        </svg>
      </span>
    );
  }

  // ── Backlog / Todo / In Progress — outer ring (+ amber sweep) ────
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
