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
