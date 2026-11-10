-- Calendar events: a plan on the Calendar that is not a piece of work —
-- a meeting, a visit, a day off. Made with a title and a day (and, when
-- it has one, a start and an end time), seen by everyone in the Space,
-- and drawn filled so it reads apart from the Elements around it. It may
-- name Elements it is about; it never stands in for one, and it belongs
-- to no Object.
--
-- Days and times are local wall-clock values, the way an Element's
-- start_date / due_date / start_time / due_time are: an event with no
-- times is an all-day event, and runs from start_date to end_date.
--
-- Who can do what (RLS):
-- - read: anyone in the Space;
-- - create: anyone in the Space, as themselves;
-- - change or delete: the person who made it, or the Space's owner;
-- - its Element links follow the event's writers, and only an Element
--   the writer can read can be linked.
--
-- Guarded for preview replay: the base schema (activity_spaces,
-- elements, the membership functions) lives outside this folder.

do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.elements') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'calendar events skipped: base schema not present';
    return;
  end if;

  create table if not exists public.calendar_events (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    title text not null,
    start_date date not null,
    end_date date not null,
    start_time time,
    end_time time,
    created_by uuid not null default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint calendar_events_title_check check (char_length(btrim(title)) between 1 and 500),
    constraint calendar_events_dates_check check (end_date >= start_date),
    -- Both times or neither: an event is timed or all-day, never half.
    constraint calendar_events_times_check check ((start_time is null) = (end_time is null)),
    constraint calendar_events_same_day_order_check
      check (start_time is null or end_date > start_date or end_time > start_time)
  );

  create index if not exists calendar_events_space_dates_idx
    on public.calendar_events (activity_space_id, start_date, end_date);

  create table if not exists public.calendar_event_elements (
    event_id uuid not null references public.calendar_events(id) on delete cascade,
    element_id uuid not null references public.elements(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (event_id, element_id)
  );

  create index if not exists calendar_event_elements_element_idx
    on public.calendar_event_elements (element_id);

  alter table public.calendar_events enable row level security;
  alter table public.calendar_event_elements enable row level security;

  drop policy if exists calendar_events_select on public.calendar_events;
  create policy calendar_events_select on public.calendar_events
    for select to authenticated
    using (public.is_activity_space_member(activity_space_id));

  drop policy if exists calendar_events_insert on public.calendar_events;
  create policy calendar_events_insert on public.calendar_events
    for insert to authenticated
    with check (created_by = auth.uid() and public.is_activity_space_member(activity_space_id));

  drop policy if exists calendar_events_update on public.calendar_events;
  create policy calendar_events_update on public.calendar_events
    for update to authenticated
    using (created_by = auth.uid() or public.is_activity_space_owner(activity_space_id))
    with check (public.is_activity_space_member(activity_space_id));

  drop policy if exists calendar_events_delete on public.calendar_events;
  create policy calendar_events_delete on public.calendar_events
    for delete to authenticated
    using (created_by = auth.uid() or public.is_activity_space_owner(activity_space_id));

  drop policy if exists calendar_event_elements_select on public.calendar_event_elements;
  create policy calendar_event_elements_select on public.calendar_event_elements
    for select to authenticated
    using (exists (
      select 1 from public.calendar_events ev
      where ev.id = event_id and public.is_activity_space_member(ev.activity_space_id)
    ));

  drop policy if exists calendar_event_elements_insert on public.calendar_event_elements;
  create policy calendar_event_elements_insert on public.calendar_event_elements
    for insert to authenticated
    with check (
      exists (
        select 1 from public.calendar_events ev
        where ev.id = event_id
          and (ev.created_by = auth.uid() or public.is_activity_space_owner(ev.activity_space_id))
      )
      and exists (select 1 from public.elements e where e.id = element_id)
    );

  drop policy if exists calendar_event_elements_delete on public.calendar_event_elements;
  create policy calendar_event_elements_delete on public.calendar_event_elements
    for delete to authenticated
    using (exists (
      select 1 from public.calendar_events ev
      where ev.id = event_id
        and (ev.created_by = auth.uid() or public.is_activity_space_owner(ev.activity_space_id))
    ));

  grant select, insert, update, delete on public.calendar_events to authenticated;
  grant select, insert, delete on public.calendar_event_elements to authenticated;

  -- updated_at follows every change; who made it and which Space it is in
  -- never change (the update policy cannot see the old row).
  create or replace function public.calendar_events_touch() returns trigger
    language plpgsql set search_path = public as $fn$
  begin
    new.created_by := old.created_by;
    new.activity_space_id := old.activity_space_id;
    new.updated_at := now();
    return new;
  end $fn$;

  drop trigger if exists calendar_events_touch on public.calendar_events;
  create trigger calendar_events_touch before update on public.calendar_events
    for each row execute function public.calendar_events_touch();
end $$;
