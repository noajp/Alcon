'use client';

// Calendar events: plans on the Calendar that are not work — a meeting,
// a visit, a day off (supabase/migrations/…_calendar_events.sql). Everyone
// in the Space sees them; the person who made one, or the Space's owner,
// changes it. An event may name Elements it is about.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface CalendarEvent {
  id: string;
  activity_space_id: string;
  title: string;
  /** `yyyy-MM-dd`, local. */
  start_date: string;
  end_date: string;
  /** `HH:mm[:ss]`, local; both null for an all-day event. */
  start_time: string | null;
  end_time: string | null;
  created_by: string;
  element_ids: string[];
}

export interface CalendarEventInput {
  title: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  element_ids: string[];
}

const COLUMNS = 'id, activity_space_id, title, start_date, end_date, start_time, end_time, created_by, calendar_event_elements(element_id)';

type Row = Omit<CalendarEvent, 'element_ids'> & { calendar_event_elements: { element_id: string }[] | null };

const toEvent = (row: Row): CalendarEvent => {
  const { calendar_event_elements: links, ...rest } = row;
  return { ...rest, element_ids: (links ?? []).map((l) => l.element_id) };
};

const KEY = 'calendar-events';
const EMPTY: CalendarEvent[] = [];

/** The Space's events. */
export function useCalendarEvents(spaceId: string | null) {
  const query = useQuery({
    queryKey: [KEY, spaceId],
    queryFn: async ({ signal }) => {
      const { data, error } = await supabase.from('calendar_events').select(COLUMNS)
        .eq('activity_space_id', spaceId!).order('start_date').abortSignal(signal);
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as Row[]).map(toEvent);
    },
    enabled: !!spaceId,
    staleTime: 15_000,
  });
  return { events: query.data ?? EMPTY, error: query.error as Error | null, refetch: query.refetch };
}

/** Re-read the events after a write. */
export function useInvalidateCalendarEvents() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [KEY] });
}

const fields = (input: CalendarEventInput) => ({
  title: input.title.trim(),
  start_date: input.start_date,
  end_date: input.end_date,
  start_time: input.start_time,
  end_time: input.end_time,
});

async function setLinks(eventId: string, wanted: string[], had: string[]) {
  const add = wanted.filter((id) => !had.includes(id));
  const drop = had.filter((id) => !wanted.includes(id));
  if (add.length) {
    const { error } = await supabase.from('calendar_event_elements')
      .insert(add.map((element_id) => ({ event_id: eventId, element_id })));
    if (error) throw new Error(error.message);
  }
  if (drop.length) {
    const { error } = await supabase.from('calendar_event_elements')
      .delete().eq('event_id', eventId).in('element_id', drop);
    if (error) throw new Error(error.message);
  }
}

export async function createCalendarEvent(spaceId: string, input: CalendarEventInput): Promise<string> {
  const { data, error } = await supabase.from('calendar_events')
    .insert({ activity_space_id: spaceId, ...fields(input) }).select('id').single();
  if (error || !data) throw new Error(error?.message ?? 'The event was not saved.');
  await setLinks(data.id, input.element_ids, []);
  return data.id;
}

export async function updateCalendarEvent(event: CalendarEvent, input: CalendarEventInput): Promise<void> {
  const { error } = await supabase.from('calendar_events').update(fields(input)).eq('id', event.id);
  if (error) throw new Error(error.message);
  await setLinks(event.id, input.element_ids, event.element_ids);
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
