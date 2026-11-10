import type { CalendarEvent, CalendarEventInput } from '@/hooks/calendarEventData';

// What the event popup edits, and the rules the database also holds
// (calendar_events' checks): a title; a day, or a run of days when all
// day; and, when timed, a start and an end time on the same day, the end
// after the start.

export interface EventDraft {
  title: string;
  allDay: boolean;
  /** `yyyy-MM-dd`. */
  startDate: string;
  /** Used when all day. */
  endDate: string;
  /** `HH:mm`, used when timed. */
  startTime: string;
  endTime: string;
  elementIds: string[];
}

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Pure. A new event's draft: from an hour-grid spot, an hour from there;
 *  from the header's button, all day on the day shown. */
export function draftFromSlot(date: string, startMinutes: number | null): EventDraft {
  if (startMinutes === null) {
    return { title: '', allDay: true, startDate: date, endDate: date, startTime: '09:00', endTime: '10:00', elementIds: [] };
  }
  const start = Math.max(0, Math.min(startMinutes, 23 * 60));
  return { title: '', allDay: false, startDate: date, endDate: date, startTime: hhmm(start), endTime: hhmm(Math.min(start + 60, 23 * 60 + 59)), elementIds: [] };
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
  if (d.allDay) return d.endDate && d.endDate >= d.startDate ? null : 'dates';
  return d.startTime && d.endTime && d.endTime > d.startTime ? null : 'times';
}

/** Pure. The draft as it is written: a timed event is one day. */
export function inputFromDraft(d: EventDraft): CalendarEventInput {
  return {
    title: d.title.trim(),
    start_date: d.startDate,
    end_date: d.allDay ? d.endDate : d.startDate,
    start_time: d.allDay ? null : d.startTime,
    end_time: d.allDay ? null : d.endTime,
    element_ids: d.elementIds,
  };
}
