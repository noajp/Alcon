import { addDays, daysBetween } from '@/Function/shared/dateUtils';

// What a drag on a Gantt bar does to its dates. A bar may have only a due
// date or only a start (it is drawn one day long); pulling either edge of it
// still makes a range — the missing end is taken to be the same day as the
// one that is set. An edge never passes the other: the range stays at least
// one day.

export type GanttDrag = 'move' | 'resize-start' | 'resize-end';

export interface DayRange { start: Date | null; end: Date | null }

/** Pure. The dates after dragging `type` by `days`. Moving shifts only the
 *  ends that are set; resizing fills the missing end first. */
export function dragRange(range: DayRange, type: GanttDrag, days: number): DayRange {
  if (!range.start && !range.end) return range;
  if (type === 'move') {
    return {
      start: range.start ? addDays(range.start, days) : null,
      end: range.end ? addDays(range.end, days) : null,
    };
  }
  const start = range.start ?? range.end!;
  const end = range.end ?? range.start!;
  if (type === 'resize-start') {
    const moved = addDays(start, days);
    return { start: daysBetween(moved, end) < 0 ? end : moved, end };
  }
  const moved = addDays(end, days);
  return { start, end: daysBetween(start, moved) < 0 ? start : moved };
}

/** Which way a dependency line runs where it meets a bar: +1 rightward, -1 leftward. */
type Run = 1 | -1;

export interface LinkRoute {
  /** The corners of the line, from the first bar to the second. */
  points: [number, number][];
  /** Where its mark sits: on the run between the two bars' rows. */
  mark: [number, number];
}

/**
 * Pure. A dependency line's route between two bar ends, as straight runs and
 * turns. It leaves (sx, sy) running `exit` (rightward out of a bar's finish,
 * leftward out of its start) and arrives at (tx, ty) running `entry`
 * (rightward into a start, leftward into a finish), going `out` px straight at
 * each end. When the two runs can meet on one vertical it is that one; when
 * the ends face away from each other the line doubles back between the rows
 * (`rowH` apart).
 */
export function linkRoute(sx: number, sy: number, exit: Run, tx: number, ty: number, entry: Run, rowH: number, out: number): LinkRoute {
  const x1 = sx + exit * out;
  const x2 = tx - entry * out;
  if (exit !== entry) {
    // Out one side and in from the same side: the vertical stands outside both.
    const v = exit === 1 ? Math.max(x1, x2) : Math.min(x1, x2);
    return { points: [[sx, sy], [v, sy], [v, ty], [tx, ty]], mark: [v, (sy + ty) / 2] };
  }
  if ((x2 - x1) * exit >= 0) {
    const v = (sx + tx) / 2;
    return { points: [[sx, sy], [v, sy], [v, ty], [tx, ty]], mark: [v, (sy + ty) / 2] };
  }
  const midY = sy + Math.sign(ty - sy || 1) * rowH / 2;
  return {
    points: [[sx, sy], [x1, sy], [x1, midY], [x2, midY], [x2, ty], [tx, ty]],
    mark: [x2, (midY + ty) / 2],
  };
}

/** Pure. A route drawn as an SVG path, its turns rounded by up to `radius`. */
export function roundedPath(points: readonly [number, number][], radius: number): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const r = Math.min(radius, Math.hypot(cx - px, cy - py) / 2, Math.hypot(nx - cx, ny - cy) / 2);
    const ax = cx - Math.sign(cx - px) * r, ay = cy - Math.sign(cy - py) * r;
    const bx = cx + Math.sign(nx - cx) * r, by = cy + Math.sign(ny - cy) * r;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const [ex, ey] = points[points.length - 1];
  return `${d} L ${ex} ${ey}`;
}
