-- The self-build loop's event bus.
--
-- Friction's board already pushes: elements, element_comments and
-- element_assignees are in the supabase_realtime publication, so a change to
-- the board reaches a listener the moment it happens. What the board cannot
-- push is everything that happens outside the database — CI going red, a PR
-- landing, a dispatched agent falling silent.
--
-- dev_events is where those get written so they arrive on the same stream.
-- One channel to drain instead of three, and the loop never has to poll.
--
-- dev_control is the governor. An event-driven loop reacts faster than a
-- scheduled one, which also means it runs away faster; `paused` is the stop
-- the listener honours before dispatching anything, and `max_concurrent`
-- bounds how many agents may be in flight at once.
--
-- Both tables are new, so nothing here alters existing schema. The publication
-- add is guarded the same way as the other migrations in this folder: preview
-- branches replay against an empty database, and the parent tables were
-- created outside it.

do $migration$
begin
  execute $ddl$
    create table if not exists public.dev_events (
      id          uuid primary key default gen_random_uuid(),
      source      text not null,          -- github | monitor | agent | human
      kind        text not null,          -- ci_failed | ci_passed | pr_merged | review_comment | stalled | ...
      ref         text,                   -- PR number, element display_id, branch — whatever identifies the subject
      title       text not null,          -- one line, this is what reaches the loop as a notification
      url         text,
      payload     jsonb,
      created_at  timestamptz not null default now(),
      consumed_at timestamptz             -- set when the loop has acted on it; null = still in the queue
    )
  $ddl$;

  execute 'create index if not exists dev_events_unconsumed_idx on public.dev_events (created_at desc) where consumed_at is null';
  execute 'create index if not exists dev_events_ref_idx on public.dev_events (ref, created_at desc)';

  execute $ddl$
    create table if not exists public.dev_control (
      id             integer primary key default 1 check (id = 1),
      paused         boolean not null default false,
      max_concurrent integer not null default 3,
      note           text,                -- why it was paused, so the loop can report it
      updated_at     timestamptz not null default now()
    )
  $ddl$;

  execute 'insert into public.dev_control (id) values (1) on conflict (id) do nothing';

  -- ── RLS ────────────────────────────────────────────────────────────────────
  -- Same bar as elements: any signed-in member of the workspace can read and
  -- write. GitHub Actions and the listener use the service role and bypass this.
  execute 'alter table public.dev_events  enable row level security';
  execute 'alter table public.dev_control enable row level security';

  execute 'drop policy if exists dev_events_rw on public.dev_events';
  execute $sql$
    create policy dev_events_rw on public.dev_events
      for all using (auth.uid() is not null) with check (auth.uid() is not null)
  $sql$;

  execute 'drop policy if exists dev_control_rw on public.dev_control';
  execute $sql$
    create policy dev_control_rw on public.dev_control
      for all using (auth.uid() is not null) with check (auth.uid() is not null)
  $sql$;

  -- ── Realtime ───────────────────────────────────────────────────────────────
  -- dev_events joins the stream the board already broadcasts on. dev_control
  -- too, so flipping `paused` reaches a running listener immediately rather
  -- than at its next read.
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dev_events'
  ) then
    execute 'alter publication supabase_realtime add table public.dev_events';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dev_control'
  ) then
    execute 'alter publication supabase_realtime add table public.dev_control';
  end if;
end
$migration$;
