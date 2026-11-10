import type { AlconObject, ElementWithDetails } from '@/types/database';
import type { ExplorerData } from '@/Function/sync/explorerPatch';
import type { CalendarEvent } from '@/hooks/calendarEventData';
import { shiftDateOnly } from '@/Function/shared/dateUtils';

export type CalendarEntry = Pick<ElementWithDetails,
  'id' | 'title' | 'start_date' | 'due_date' | 'start_time' | 'due_time' | 'color' | 'status' | 'priority' | 'estimated_hours'
> & (
  | { element: ElementWithDetails; object?: never; event?: never }
  | { object: AlconObject; element?: never; event?: never }
  | { event: CalendarEvent; element?: never; object?: never }
);

/** The day part of either column shape. `elements.start_date` is a timestamp
 *  and comes back as `2026-09-12T00:00:00+00:00`, while `due_date` is a plain
 *  date — and compared as strings the timestamp sorts *after* its own day, so
 *  an Element with a range used to skip the first day it covers. */
const dayOf = (value: string) => value.slice(0, 10);

/** The days an entry covers, as `yyyy-MM-dd` bounds. A pair with the start
 *  after the due is not a span at all — it stays off the grid, the same way
 *  an undated entry does, rather than being silently read backwards. */
function spanOf(entry: { start_date: string | null; due_date: string | null }): { s: string; e: string } | null {
  const start = entry.start_date ?? entry.due_date;
  const end = entry.due_date ?? entry.start_date;
  if (!start || !end) return null;
  const s = dayOf(start);
  const e = dayOf(end);
  return s <= e ? { s, e } : null;
}

export function occursOn(entry: { start_date: string | null; due_date: string | null }, date: string): boolean {
  const span = spanOf(entry);
  return Boolean(span && span.s <= dayOf(date) && dayOf(date) <= span.e);
}

/** Everything the Calendar draws: Elements, Objects with dates, and the
 *  Space's events (a plan, not work: no status, never overdue). */
export function calendarEntries(elements: ElementWithDetails[], objects: AlconObject[] = [], events: CalendarEvent[] = []): CalendarEntry[] {
  return [
    ...events.map(event => ({
      id: `event:${event.id}`, title: event.title, start_date: event.start_date, due_date: event.end_date,
      start_time: event.start_time, due_time: event.end_time, color: null,
      status: null, priority: null, estimated_hours: null, event,
    })),
    ...elements.map(element => ({ ...element, element })),
    ...objects.map(object => ({
      id: `object:${object.id}`, title: object.name, start_date: object.start_date,
      due_date: object.due_date, start_time: null, due_time: null, color: object.color,
      status: null, priority: null, estimated_hours: null, object,
    })),
  ];
}

export function selectCalendarScope(explorers: ExplorerData[], selectedObjectIds: string[]) {
  const availableObjects = [...new Map(explorers.flatMap(data => data.objects).map(object => [object.id, object])).values()];
  const objects = availableObjects.filter(object => selectedObjectIds.includes(object.id));
  const rows = selectedObjectIds.length
    ? objects.flatMap(object => object.elements ?? [])
    : explorers.flatMap(data => data.objects.flatMap(object => object.elements ?? []));
  return { availableObjects, objects, elements: [...new Map(rows.map(element => [element.id, element])).values()] };
}

/** Clip a timed interval to a local calendar day; midnight end is exclusive. */
function timeWindow(entry: CalendarEntry, day: string): { start: number; end: number } | null {
  if (!occursOn(entry, day) || (!entry.start_time && !entry.due_time)) return null;
  const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
  const startDate = entry.start_date ?? entry.due_date;
  const endDate = entry.due_date ?? entry.start_date;
  const spansDays = startDate !== endDate;
  const start = day !== startDate ? 0 : entry.start_time ? minutes(entry.start_time)
    : spansDays ? 0 : minutes(entry.due_time!);
  const end = day !== endDate ? 1440
    : spansDays ? entry.due_time ? minutes(entry.due_time) : 1440
    : entry.start_time && entry.due_time ? minutes(entry.due_time)
    : Math.min(1440, start + (entry.estimated_hours && entry.estimated_hours > 0 ? entry.estimated_hours * 60 : 60));
  return end > start ? { start, end } : null;
}

/** Overlapping events share columns; disjoint groups regain the full width. */
export function layoutTimedEntries(entries: CalendarEntry[], day: string) {
  const items = entries.flatMap(entry => { const window = timeWindow(entry, day); return window ? [{ entry, ...window, lane: 0, columns: 1 }] : []; })
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let group: typeof items = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const finish = () => { for (const item of group) item.columns = ends.length; group = []; ends = []; };
  for (const item of items) {
    if (item.start >= groupEnd) finish();
    let lane = ends.findIndex(end => end <= item.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.end;
    item.lane = lane;
    group.push(item);
    groupEnd = Math.max(groupEnd, item.end);
  }
  finish();
  return items;
}

/** Elements the Calendar keeps once some Workers are hidden. An Element with
 *  no assignee belongs to nobody in particular and always stays; one shared
 *  by a hidden and a shown Worker stays for the shown one. */
export function filterByWorkers<T extends { assignees?: { worker_id: string }[] }>(elements: T[], hiddenWorkerIds: string[]): T[] {
  if (hiddenWorkerIds.length === 0) return elements;
  const hidden = new Set(hiddenWorkerIds);
  return elements.filter(element => !element.assignees?.length || element.assignees.some(assignee => !hidden.has(assignee.worker_id)));
}

/** `yyyy-MM` of a `yyyy-MM-dd` day. */
export const monthOf = (day: string): string => day.slice(0, 7);

/** The same `yyyy-MM`, moved by whole months. */
export function shiftMonth(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${moved.getUTCFullYear()}-${`${moved.getUTCMonth() + 1}`.padStart(2, '0')}`;
}

/** The six rows of days a mini month shows for `yyyy-MM`, starting on the
 *  preferred weekday, so every grid is the same height. */
export function miniMonthDays(month: string, weekStartsOn: number): string[] {
  const first = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const offset = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() - weekStartsOn + 7) % 7;
  return Array.from({ length: 42 }, (_, i) => shiftDateOnly(first, i - offset));
}

/** One Element (or Object) drawn across a week row of the month grid: the
 *  columns it covers in that week, clipped to the week, and the lane it was
 *  stacked into so bands never overlap. `continuesBefore` / `continuesAfter`
 *  say the span runs on past this week's edge. */
export interface WeekSpan {
  entry: CalendarEntry;
  startCol: number;
  endCol: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Lay the entries that touch a week (seven `yyyy-MM-dd` days) out as bands.
 *  Earlier starts take the upper lanes; among the same start the longer band
 *  goes first, so a long span keeps one lane across the weeks it crosses as
 *  often as the shorter ones around it allow. */
export function layoutWeekSpans(entries: CalendarEntry[], week: string[]): WeekSpan[] {
  const first = week[0];
  const last = week[week.length - 1];
  const spans = entries.flatMap(entry => {
    const span = spanOf(entry);
    if (!span) return [];
    const { s, e } = span;
    if (e < first || s > last) return [];
    const startCol = s < first ? 0 : week.indexOf(s);
    const endCol = e > last ? week.length - 1 : week.indexOf(e);
    if (startCol < 0 || endCol < 0) return [];
    return [{ entry, startCol, endCol, lane: 0, continuesBefore: s < first, continuesAfter: e > last }];
  });
  spans.sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol) || a.entry.title.localeCompare(b.entry.title));
  const laneEnds: number[] = [];
  for (const span of spans) {
    let lane = laneEnds.findIndex(end => end < span.startCol);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = span.endCol;
    span.lane = lane;
  }
  return spans;
}
