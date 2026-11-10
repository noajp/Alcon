import type { CalendarEvent, CalendarEventInput } from '@/hooks/calendarEventData';

// What the event popup edits, and the rules the database also holds
// (calendar_events' checks): a title; a start day and an end day not
// before it; and, when timed, an end after the start.

export interface EventDraft {
  title: string;
  allDay: boolean;
  /** `yyyy-MM-dd`. */
  startDate: string;
  endDate: string;
  /** `HH:mm`, used when timed. */
  startTime: string;
  endTime: string;
  elementIds: string[];
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Pure. A new event's draft: from an hour-grid spot, the half hour
 *  there; from the header's button, all day on the day shown. */
export function draftFromSlot(date: string, startMinutes: number | null): EventDraft {
  if (startMinutes === null) {
    return { title: '', allDay: true, startDate: date, endDate: date, startTime: '09:00', endTime: '10:00', elementIds: [] };
  }
  const start = Math.max(0, Math.min(startMinutes, 23 * 60 + 30));
  return { title: '', allDay: false, startDate: date, endDate: date, startTime: hhmm(start), endTime: hhmm(Math.min(start + 30, 23 * 60 + 59)), elementIds: [] };
}

/** Pure. An existing event, as the popup edits it. */
export function draftFromEvent(event: CalendarEvent): EventDraft {
  const allDay = !event.start_time;
  return {
    title: event.title,
    allDay,
    startDate: event.start_date,
    endDate: event.end_date,
    startTime: event.start_time?.slice(0, 5) ?? '09:00',
    endTime: event.end_time?.slice(0, 5) ?? '10:00',
    elementIds: [...event.element_ids],
  };
}

export type DraftProblem = 'title' | 'date' | 'dates' | 'times';

/** Pure. What keeps the draft from being saved, or null. */
export function draftProblem(d: EventDraft): DraftProblem | null {
  if (!d.title.trim()) return 'title';
  if (!d.startDate) return 'date';
  if (!d.endDate || d.endDate < d.startDate) return 'dates';
  if (d.allDay) return null;
  if (!d.startTime || !d.endTime) return 'times';
  return d.endDate > d.startDate || d.endTime > d.startTime ? null : 'times';
}

/** Pure. How long a timed draft runs, in minutes; null when all day or
 *  not yet a valid span. */
export function draftMinutes(d: EventDraft): number | null {
  if (d.allDay || draftProblem({ ...d, title: d.title || 'x' })) return null;
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const days = Math.round((Date.UTC(...ymd(d.endDate)) - Date.UTC(...ymd(d.startDate))) / 86_400_000);
  return days * 1440 + toMin(d.endTime) - toMin(d.startTime);
}

const ymd = (date: string): [number, number, number] => {
  const [y, m, dd] = date.split('-').map(Number);
  return [y, m - 1, dd];
};

/** Pure. "30m", "1h", "1h 30m", "2d 3h". */
export function durationLabel(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d ? `${d}d` : '', h ? `${h}h` : '', m ? `${m}m` : ''].filter(Boolean).join(' ') || '0m';
}

/** Pure. The draft as it is written. */
export function inputFromDraft(d: EventDraft): CalendarEventInput {
  return {
    title: d.title.trim(),
    start_date: d.startDate,
    end_date: d.endDate,
    start_time: d.allDay ? null : d.startTime,
    end_time: d.allDay ? null : d.endTime,
    element_ids: d.elementIds,
  };
}
