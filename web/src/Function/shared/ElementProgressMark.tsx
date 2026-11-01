'use client';

import type { ReactNode } from 'react';
import type { CustomColumnWithValues, ElementWithDetails } from '@/hooks/useSupabase';
import type { ElementStatus } from '@/types/database';
import { STATUS } from '@/shared/designTokens';

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

/** Pure. The share of SubElements checked off, as a whole percent. */
function subelementProgress(subelements: { is_completed?: boolean | null }[]): number {
  if (subelements.length === 0) return 0;
  const completed = subelements.filter((sub) => !!sub.is_completed).length;
  return Math.round((completed / subelements.length) * 100);
}

export function getElementProgress(
  element: ElementWithDetails,
  customColumns?: CustomColumnWithValues[],
): number {
  // A done Element is always 100% — its mark/percentage must never read
  // lower just because subelements or a custom tag lag behind.
  if (element.status === 'done') return 100;

  // SubElements decide it when there are any: the share checked off. The
  // database writes the same number to `progress` (and Done when all are
  // checked off); reading it from the list here shows a check-off at once.
  const subelements = element.subelements ?? [];
  if (subelements.length > 0) return subelementProgress(subelements);

  // Otherwise the % set in the status picker.
  if (typeof element.progress === 'number') {
    return Math.max(0, Math.min(100, Math.round(element.progress)));
  }

  const customProgress = getCustomProgress(element.id, customColumns);
  if (customProgress !== null) return customProgress;

  return 0;
}

// Status mark — one cohesive outline set: every status is a ring with an inner
// glyph, drawn in `currentColor` so the wrapper's text colour tints the whole
// mark.
//   backlog     → dashed ring
//   todo / null → solid ring
//   in_progress → solid ring + inner disc, a pie filled to progress%
//                 (half when no progress is known yet, so it never reads
//                 as an empty To Do ring)
//   review      → filled disc + white review lines
//   done        → filled disc + white check
//   blocked     → ring + horizontal bar
//   cancelled   → ring + ×
// Glyphs are authored on a 48-unit grid (ring r=15, centre 24). A `<g>`
// transform scales that grid so the ring fills the box at the SAME diameter the
// old mark used ((size-2)/2), and stroke widths are pre-divided by the scale so
// they still render at a constant on-screen px (crisp at 14px in a dense row).
// The tint comes from `STATUS[key].color` in designTokens — the mark does not
// keep a palette of its own. This mark is the most-seen status surface in the
// app, so its hues ARE the --element-status-* ramp; every other surface reads
// the same table.
const STATUS_TEXT: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS).map(([key, meta]) => [key, meta.color]),
);

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

  let inner: ReactNode;
  switch (key) {
    case 'backlog':
      inner = (
        <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth={sw(1.7)} strokeLinecap="round" strokeDasharray="2.4 6.4" />
      );
      break;
    case 'in_progress': {
      // The inner disc is a pie: its rim (r=9) is drawn as a wide stroke of
      // r=4.5 so a dash of the circumference fills a wedge from 12 o'clock.
      const share = pct > 0 ? pct : 50;
      const innerC = 2 * Math.PI * 4.5;
      inner = (
        <>
          <circle cx="24" cy="24" r="15" fill="none" stroke="currentColor" strokeWidth={sw(1.7)} />
          {share >= 100 ? (
            <circle cx="24" cy="24" r="9" fill="currentColor" />
          ) : (
            <circle
              cx="24" cy="24" r="4.5" fill="none" stroke="currentColor" strokeWidth="9"
              strokeDasharray={`${((innerC * share) / 100).toFixed(3)} ${innerC.toFixed(3)}`}
              transform="rotate(-90 24 24)"
            />
          )}
        </>
      );
      break;
    }
    case 'review':
      // Filled disc + white review lines — the same silhouette as Done, with
      // the lines knocked out where Done has its check.
      inner = (
        <>
          <circle cx="24" cy="24" r="15" fill="currentColor" stroke="currentColor" strokeWidth={sw(1.7)} />
          <path d="M17 20h14 M17 28h9" fill="none" stroke="var(--primary-foreground)" strokeWidth={sw(2.2)} strokeLinecap="round" />
        </>
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
            d="M16.8 24 L21.7 30.8 L31.6 18.2"
            fill="none" stroke="var(--primary-foreground)" strokeWidth={sw(1.6)}
            strokeLinecap="round" strokeLinejoin="round"
          />
        </>
      );
      break;
    case 'blocked':
      inner = (
        <g fill="none" stroke="currentColor" strokeWidth={sw(1.7)} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="24" cy="24" r="15" />
          <path d="M18 24h12" />
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
      {/* text-current: the svg takes the wrapper's status colour even where
          a parent recolours bare svgs (menu items mute them). */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" className="text-current">
        <g transform={groupTransform}>{inner}</g>
      </svg>
    </span>
  );
}
