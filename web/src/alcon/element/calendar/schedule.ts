import type { AlconObject, ElementWithDetails } from '@/types/database';
import type { ExplorerData } from '@/alcon/sync/explorerPatch';

export type CalendarEntry = Pick<ElementWithDetails,
  'id' | 'title' | 'start_date' | 'due_date' | 'start_time' | 'due_time' | 'color' | 'status' | 'priority' | 'estimated_hours'
> & ({ element: ElementWithDetails; object?: never } | { object: AlconObject; element?: never });

/** The day part of either column shape. `elements.start_date` is a timestamp
 *  and comes back as `2026-09-12T00:00:00+00:00`, while `due_date` is a plain
 *  date — and compared as strings the timestamp sorts *after* its own day, so
 *  an Element with a range used to skip the first day it covers. */
const dayOf = (value: string) => value.slice(0, 10);

export function occursOn(entry: { start_date: string | null; due_date: string | null }, date: string): boolean {
  const start = entry.start_date ?? entry.due_date;
  const end = entry.due_date ?? entry.start_date;
  return Boolean(start && end && dayOf(start) <= dayOf(date) && dayOf(date) <= dayOf(end));
}

export function calendarEntries(elements: ElementWithDetails[], objects: AlconObject[] = []): CalendarEntry[] {
  return [
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
