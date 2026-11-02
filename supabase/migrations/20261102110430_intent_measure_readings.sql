-- A success condition keeps every reading, not only the last one (ELE_OBJ2-005).
--
-- intents.actual_value / measured_at stay the latest reading, as before. Every
-- change to them is also appended here by the database, so no writer can skip
-- it: the Measures widget, the CRM pipeline binding, Copilot's campaignMeasure,
-- and plain SQL all land in the same history.
--
-- One row per reading: the value (null = the reading was cleared), the value
-- it replaced, the target and direction in force at that moment, who wrote it,
-- and where it came from. Rows are written only by the trigger and are never
-- updated or deleted by users; they go away with their measure.
--
-- source names the path. It is read from, in order:
--   1. the transaction setting alcon.reading_source (server-side writers:
--      set_config('alcon.reading_source', 'crm', true) before the update);
--   2. the request header x-alcon-reading-source (PostgREST clients);
--   3. 'system' when nobody is signed in, otherwise 'other'.
-- It is a label for people reading the history, not an authorization claim;
-- recorded_by is always auth.uid().
--
-- Later work builds on the trigger: previous_value and the target/direction
-- snapshot let a consumer tell, from one row, whether the condition went from
-- met to missed without re-reading intents.
--
-- Guarded for preview replay: intents is created outside this folder.
do $migration$
begin
  if to_regclass('public.intents') is null then
    raise notice 'intent measure readings skipped: intents not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.intent_measure_readings (
      id uuid primary key default gen_random_uuid(),
      intent_id uuid not null references public.intents(id) on delete cascade,
      value numeric,
      previous_value numeric,
      measured_at timestamptz,
      target_value numeric,
      direction text,
      unit text,
      source text not null default 'other'
        check (source in ('manual', 'crm', 'copilot', 'api', 'mcp', 'agent', 'system', 'backfill', 'other')),
      recorded_by uuid references auth.users(id) on delete set null,
      recorded_by_name text,
      recorded_at timestamptz not null default clock_timestamp()
    )
  $ddl$;
  execute 'create index if not exists intent_measure_readings_intent_idx
             on public.intent_measure_readings (intent_id, recorded_at desc)';

  execute 'alter table public.intent_measure_readings enable row level security';
  -- Visible exactly when the measure is: the subquery on intents runs under
  -- intents' own select policy, so this follows it if that policy changes.
  execute 'drop policy if exists intent_measure_readings_select on public.intent_measure_readings';
  execute $ddl$
    create policy intent_measure_readings_select on public.intent_measure_readings
      for select using (exists (select 1 from public.intents i where i.id = intent_measure_readings.intent_id))
  $ddl$;
  -- No insert / update / delete policy: only the trigger writes.
  execute 'revoke insert, update, delete on public.intent_measure_readings from anon, authenticated';
  execute 'grant select on public.intent_measure_readings to authenticated';

  execute $ddl$
    create or replace function public.intent_record_measure_reading() returns trigger
    language plpgsql security definer set search_path = public as $fn$
    declare
      v_source text;
      v_previous numeric;
      v_name text;
    begin
      if new.kind is distinct from 'measure' then return new; end if;
      if tg_op = 'INSERT' then
        if new.actual_value is null then return new; end if;
        v_previous := null;
      else
        -- A re-read of the same value with a new timestamp is a reading; a
        -- timestamp change with no value is not.
        if new.actual_value is not distinct from old.actual_value
           and (new.actual_value is null or new.measured_at is not distinct from old.measured_at) then
          return new;
        end if;
        v_previous := old.actual_value;
      end if;

      v_source := nullif(current_setting('alcon.reading_source', true), '');
      if v_source is null then
        begin
          v_source := nullif(nullif(current_setting('request.headers', true), '')::json ->> 'x-alcon-reading-source', '');
        exception when others then
          v_source := null;
        end;
      end if;
      v_source := lower(coalesce(v_source, case when auth.uid() is null then 'system' else 'other' end));
      if v_source not in ('manual', 'crm', 'copilot', 'api', 'mcp', 'agent', 'system', 'other') then
        v_source := 'other';
      end if;

      -- A person's own human Worker (one per person, not tied to a Space) names them.
      if auth.uid() is not null then
        select w.name into v_name from public.workers w
          where w.user_id = auth.uid() and w.type = 'human' and w.object_id is null
          limit 1;
      end if;

      insert into public.intent_measure_readings
        (intent_id, value, previous_value, measured_at, target_value, direction, unit, source, recorded_by, recorded_by_name)
      values
        (new.id, new.actual_value, v_previous,
         case when new.actual_value is null then null else coalesce(new.measured_at, now()) end,
         new.target_value, new.direction, new.unit, v_source, auth.uid(), v_name);
      return new;
    end $fn$
  $ddl$;
  execute 'revoke execute on function public.intent_record_measure_reading() from public, anon';

  execute 'drop trigger if exists intents_record_measure_reading_ins on public.intents';
  execute 'create trigger intents_record_measure_reading_ins after insert on public.intents
             for each row execute function public.intent_record_measure_reading()';
  execute 'drop trigger if exists intents_record_measure_reading_upd on public.intents';
  execute 'create trigger intents_record_measure_reading_upd after update of actual_value, measured_at on public.intents
             for each row execute function public.intent_record_measure_reading()';

  -- The reading already on the board becomes the first row of its history,
  -- so the latest row always matches actual_value.
  execute $ddl$
    insert into public.intent_measure_readings
      (intent_id, value, measured_at, target_value, direction, unit, source, recorded_at)
    select i.id, i.actual_value, coalesce(i.measured_at, i.updated_at), i.target_value, i.direction, i.unit,
           'backfill', coalesce(i.measured_at, i.updated_at)
    from public.intents i
    where i.kind = 'measure' and i.actual_value is not null
      and not exists (select 1 from public.intent_measure_readings r where r.intent_id = i.id)
  $ddl$;
end $migration$;
