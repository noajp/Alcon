'use client';

import { Send, Slash, Check } from 'lucide-react';
import type { CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';
import type { ElementStatus } from '@/types/database';

export function clampProgress(value: unknown): number | null {
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
  // A done Element is always 100% — its mark/percentage must never read
  // lower just because subelements or a custom tag lag behind.
  if (element.status === 'done') return 100;

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

  return 0;
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
  // 100% always reads as Done — keeps the mark in sync regardless of the
  // stored status. Blocked / Cancelled / In Review are deliberate
  // non-completion states and keep their own mark.
  const effective: typeof status =
    pct >= 100 && status !== 'blocked' && status !== 'cancelled' && status !== 'review'
      ? 'done'
      : status;
  const center = size / 2;
  const ringStrokeWidth = 1.8;
  const outerRadius = (size - 2) / 2;
  // For solid-disc statuses (done / review) — match the outer edge of the
  // Todo ring so the marks read the same diameter.
  const discRadius = outerRadius + ringStrokeWidth / 2;
  const pieOuter = outerRadius - 2;
  const pieStrokeR = pieOuter / 2;
  const pieStrokeW = pieOuter;
  const pieCircum = 2 * Math.PI * pieStrokeR;
  const pieDashOffset = pieCircum * (1 - pct / 100);
  const glyphSize = Math.max(8, Math.round(size * 0.6));

  // ── Blocked — solid red disc + white × that reaches the rim ────────
  if (status === 'blocked') {
    // X arms sit a touch further inside the disc rim.
    const xOff = (discRadius - 3) / Math.sqrt(2);
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle cx={center} cy={center} r={discRadius} className="fill-rose-500" />
          <g stroke="white" strokeWidth="1.75" strokeLinecap="round">
            <line x1={center - xOff} y1={center - xOff} x2={center + xOff} y2={center + xOff} />
            <line x1={center + xOff} y1={center - xOff} x2={center - xOff} y2={center + xOff} />
          </g>
        </svg>
      </span>
    );
  }

  // ── Done — solid green disc + white check (no outer ring) ───────────
  if (effective === 'done') {
    return (
      <span
        className="relative inline-flex shrink-0 items-center justify-center rounded-full"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
          <circle cx={center} cy={center} r={discRadius} style={{ fill: 'var(--status-success)' }} />
        </svg>
        <Check size={glyphSize} strokeWidth={3.5} className="relative text-white" />
      </span>
    );
  }

  // ── Review — light-blue paper-plane glyph only (no disc) ────────────
  if (effective === 'review') {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <Send size={size - 2} strokeWidth={2.5} className="text-sky-500" />
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
        <Slash size={glyphSize} strokeWidth={2.5} className="relative" />
      </span>
    );
  }

  // ── Backlog / Todo / In Progress ─────────────────────────────────────
  const isBacklog = effective === 'backlog';
  const isInProgress = effective === 'in_progress';

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/60"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0">
        <circle
          cx={center}
          cy={center}
          r={outerRadius}
          fill="none"
          stroke={isInProgress ? 'var(--status-warning)' : 'currentColor'}
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
