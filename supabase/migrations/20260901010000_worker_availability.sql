-- A Worker could be unavailable, but never from a date.
--
-- Two tabletop exercises run on this board hit the same wall from opposite
-- directions. A relief operation learned on D+3 that its medical lead rotated
-- out D+5 through D+7; a five-person company learned in week two that its only
-- German speaker was on leave for a fortnight. Both facts are periods. The
-- board had `workers.status` — active / inactive / busy — which is a single
-- flag with no tense. Setting it to inactive removes the person from today,
-- when they are still working; leaving it active leaves the plan for next week
-- lying. Neither is the truth, so in both exercises the fact ended up in the
-- prose of a comment, where nothing could count it.
--
-- The other half is capacity. ResourceView draws a daily-load chart and
-- compares it against `capacityForWorker()`, which returns the same constant
-- for every human on the board, under a comment that has read
-- "// Future: per-worker capacity_hours_per_week / 5. For now, fixed."
-- since it was written. With no per-person number there is nothing to be over,
-- so assigning a fourth urgent Element to the one person who can do the work
-- produces no signal at all — which is exactly what the company exercise did,
-- deliberately, to see whether the board would object. It did not.
--
-- So: one number that says how much a person has in a day, and rows that say
-- when that number is different. An absence is a period whose capacity is
-- zero; half-time is a period whose capacity is half. Making leave a special
-- case of capacity rather than a flag of its own means the load chart needs
-- one rule, not two, and "away" and "stretched thin" stop being different
-- kinds of fact.
--
-- Nothing here decides policy. A null standing capacity keeps today's constant
-- as the default, so this migration changes no number that anyone currently
-- sees; it only makes a different number expressible.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `workers` is created outside it.

do $migration$
begin
  if to_regclass('public.workers') is null then
    raise notice 'worker_availability skipped: workers not present';
    return;
  end if;

  -- The standing figure. Null means "whatever the client defaults to", which
  -- is how every existing row reads, so no behaviour moves until someone sets
  -- one. Hours per *day* rather than per week because that is the unit the
  -- load chart already works in, and dividing a weekly figure by five bakes in
  -- an assumption about the working week that not every Space shares.
  execute 'alter table public.workers
           add column if not exists capacity_hours_per_day numeric';

  execute $ddl$
    alter table public.workers
      drop constraint if exists workers_capacity_hours_per_day_check
  $ddl$;
  execute $ddl$
    alter table public.workers
      add constraint workers_capacity_hours_per_day_check
      check (capacity_hours_per_day is null
             or (capacity_hours_per_day >= 0 and capacity_hours_per_day <= 24))
  $ddl$;

  execute $ddl$
    create table if not exists public.worker_availability (
      id         uuid primary key default gen_random_uuid(),
      worker_id  uuid not null references public.workers(id) on delete cascade,
      -- Inclusive on both ends. "Away the 5th through the 7th" is how the
      -- absence is spoken, and a half-open range would have every caller
      -- adding a day before it could ask the question it actually has.
      start_date date not null,
      end_date   date not null,
      -- What kind of absence, for the reader rather than the arithmetic: the
      -- load chart only reads the capacity. Small closed set because an open
      -- text column becomes five spellings of "vacation" within a month.
      kind       text not null default 'leave'
                 check (kind in ('leave', 'rotation', 'assignment', 'other')),
      -- The capacity *during* this period. Zero is the common case and the
      -- default: gone. A number above zero is partial availability, which is
      -- why this is not a boolean.
      capacity_hours_per_day numeric not null default 0
                 check (capacity_hours_per_day >= 0 and capacity_hours_per_day <= 24),
      note       text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint worker_availability_dates_ordered check (end_date >= start_date)
    )
  $ddl$;

  -- Every question this table answers is "who is away, and when" over a range,
  -- so the index carries the dates rather than the worker alone.
  execute 'create index if not exists worker_availability_span_idx
           on public.worker_availability (worker_id, start_date, end_date)';

  -- ── RLS ────────────────────────────────────────────────────────────────────
  -- The visibility question is deferred to `workers` rather than answered
  -- here. A policy subquery is evaluated under the caller's own RLS, so an
  -- availability row is exactly as visible as the Worker it belongs to — and
  -- the day the Worker boundary is tightened, these tighten with it and there
  -- is nothing to change in this file. The same reasoning strategy_comments
  -- used for `strategies` (20260830000005).
  --
  -- Writes are as wide as reads on purpose. Knowing a teammate is on leave and
  -- being able to record it are the same act here; a narrower rule would mean
  -- the person who knows cannot say so, which is the failure this table exists
  -- to remove. Tighten it when Space roles exist to tighten it against.
  execute 'alter table public.worker_availability enable row level security';

  execute 'drop policy if exists worker_availability_select on public.worker_availability';
  execute $ddl$
    create policy worker_availability_select on public.worker_availability
      for select using (
        exists (select 1 from public.workers w where w.id = worker_id)
      )
  $ddl$;

  execute 'drop policy if exists worker_availability_insert on public.worker_availability';
  execute $ddl$
    create policy worker_availability_insert on public.worker_availability
      for insert with check (
        auth.uid() is not null
        and exists (select 1 from public.workers w where w.id = worker_id)
      )
  $ddl$;

  execute 'drop policy if exists worker_availability_update on public.worker_availability';
  execute $ddl$
    create policy worker_availability_update on public.worker_availability
      for update using (
        auth.uid() is not null
        and exists (select 1 from public.workers w where w.id = worker_id)
      )
  $ddl$;

  execute 'drop policy if exists worker_availability_delete on public.worker_availability';
  execute $ddl$
    create policy worker_availability_delete on public.worker_availability
      for delete using (
        auth.uid() is not null
        and exists (select 1 from public.workers w where w.id = worker_id)
      )
  $ddl$;
end $migration$;
