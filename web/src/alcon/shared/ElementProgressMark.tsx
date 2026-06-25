'use client';

import type { ReactNode } from 'react';
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

// Status mark — one cohesive outline set: every status is a ring with an inner
// glyph, drawn in `currentColor` so the wrapper's text colour tints the whole
// mark.
//   backlog     → dashed ring
//   todo / null → solid ring
//   in_progress → faint track ring + foreground arc filled to progress% + dot
//   review      → ring + paper-plane glyph
//   done        → filled disc + white check
//   blocked     → ring + exclamation
//   cancelled   → ring + ×
// Glyphs are authored on a 48-unit grid (ring r=15, centre 24). A `<g>`
// transform scales that grid so the ring fills the box at the SAME diameter the
// old mark used ((size-2)/2), and stroke widths are pre-divided by the scale so
// they still render at a constant on-screen px (crisp at 14px in a dense row).
const STATUS_TEXT: Record<string, string> = {
  backlog:     'text-muted-foreground/60',
  todo:        'text-muted-foreground/70',
  in_progress: 'text-orange-500',
  review:      'text-yellow-400',
  done:        'text-[var(--status-success)]',
  blocked:     'text-[var(--status-danger)]',
  cancelled:   'text-muted-foreground/40',
};

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
  const key = (status ?? 'todo') as string;
  const colorClass = STATUS_TEXT[key] ?? STATUS_TEXT.todo;

  const center = size / 2;
  const R = (size - 2) / 2;          // rendered ring radius (matches the old mark)
  const s = R / 15;                  // scale authored 48-grid → render space
  const groupTransform = `translate(${center} ${center}) scale(${s.toFixed(4)}) translate(-24 -24)`;
  // Stroke px → authored-grid units (pre-divided by the scale so the rendered
  // stroke stays a constant px regardless of `size`).
  const sw = (px: number) => +(px / s).toFixed(3);
  const C = 2 * Math.PI * 15;        // ring circumference (authored units)
  const dash = (C * pct) / 100;

  let inner: ReactNode;
  switch (key) {
    case 'backlog':
      inner = (
        <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth={sw(1.7)} strokeLinecap="round" strokeDasharray="2.4 4.35" />
      );
      break;
    case 'in_progress':
      inner = (
        <>
          <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth={sw(1.7)} opacity="0.3" />
          {pct > 0 && (
            <circle
              cx="24" cy="24" r="15" fill="none" stroke="currentColor"
              strokeWidth={sw(1.7)} strokeLinecap="round"
              strokeDasharray={`${dash.toFixed(2)} ${C.toFixed(2)}`}
              transform="rotate(-90 24 24)"
            />
          )}
          <circle cx="24" cy="24" r="3" fill="currentColor" />
        </>
      );
      break;
    case 'review':
      inner = (
        <g fill="none" stroke="currentColor" strokeWidth={sw(1.7)} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="15" />
          <path d="M32.5 24 L15.5 16.7 L21.6 24 L15.5 31.3 Z" strokeWidth={sw(1.6)} />
          <path d="M21.6 24 L32.5 24" />
        </g>
      );
      break;
    case 'done':
      // Filled disc + white check. The disc carries the SAME ring stroke as
      // every other status so its outer silhouette matches them exactly
      // (a fill alone reads ~1.7px smaller than a stroked ring).
      inner = (
        <>
          <circle cx="24" cy="24" r="15" fill="currentColor" stroke="currentColor" strokeWidth={sw(1.7)} />
          <path
            d="M17 24.4 L21.9 29.3 L31.3 18.7"
            fill="none" stroke="#fff" strokeWidth={sw(2)}
            strokeLinecap="round" strokeLinejoin="round"
          />
        </>
      );
      break;
    case 'blocked':
      inner = (
        <g fill="none" stroke="currentColor" strokeWidth={sw(1.7)} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="15" />
          <path d="M24 16 L24 25.5" strokeWidth={sw(2)} />
          <circle cx="24" cy="30.4" r="1.7" fill="currentColor" stroke="none" />
        </g>
      );
      break;
    case 'cancelled':
      inner = (
        <g fill="none" stroke="currentColor" strokeWidth={sw(1.7)} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="15" />
          <path d="M18.6 18.6 L29.4 29.4 M29.4 18.6 L18.6 29.4" />
        </g>
      );
      break;
    case 'todo':
    default:
      inner = (
        <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth={sw(1.7)} />
      );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${colorClass}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
        <g transform={groupTransform}>{inner}</g>
      </svg>
    </span>
  );
}
