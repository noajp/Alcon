-- Definition tests (back-half program B14): the fixtures a person
-- cuts from a real run's record, and the results of replaying them.
--
--   definition_tests   one row per captured test. The fixture is the
--                      source run's integration exchanges as the
--                      model saw them (transcript responses,
--                      transport-truncated), each resolved to a
--                      canonical action and hashed by its full
--                      canonical arguments; the expected is what a
--                      replay must reproduce, derived from the
--                      fixture once, at capture. last_* columns are
--                      the latest replay's verdict — written by the
--                      engine's settle (service role) alone, which
--                      is why the table grants no update at all:
--                      there is deliberately NO update policy.
--   visibility         a fixture is a long-lived, in-Space copy of
--                      real run data, so its visibility is exactly
--                      the source run's: Space members read and
--                      capture (captured_by pinned to the caller);
--                      deletion belongs to the person who captured
--                      it or the Space's owner (the definitions
--                      delete line). The fixture body is scrubbed at
--                      capture; names/emails in args or responses
--                      are the confirmation screen's and the delete
--                      button's business, not redaction's.
--   agent_runs         unchanged: a test run is an ordinary
--                      rehearsal run whose transcript carries the
--                      fixture reference. The web reads this table
--                      from the harness editor and the constraint
--                      review — this migration must reach production
--                      BEFORE the web that selects it (the
--                      chain_scope / failure_detail coupling).
--   notifications      learns the 'definition_test' kind and the
--                      test a notification is about: the settle
--                      tells the person who launched the test, and
--                      nobody else.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.definitions') is null
     or to_regclass('public.activity_spaces') is null
     or to_regclass('public.agent_runs') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'definition tests skipped: definitions, activity_spaces, agent_runs or space role functions not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.definition_tests (
      id uuid primary key default gen_random_uuid(),
      definition_id uuid not null references public.definitions(id) on delete cascade,
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      name text not null,
      fixture jsonb not null,
      expected jsonb not null,
      source_run_id uuid references public.agent_runs(id) on delete set null,
      source_run_label text,
      source_run_status text,
      tainted boolean not null default false,
      captured_by uuid,
      captured_at timestamptz not null default now(),
      last_result jsonb,
      last_run_id uuid references public.agent_runs(id) on delete set null,
      last_run_at timestamptz,
      last_body_hash text
    )
  $ddl$;
  execute 'create index if not exists definition_tests_definition_idx on public.definition_tests (definition_id, captured_at desc)';
  execute 'create index if not exists definition_tests_space_idx on public.definition_tests (activity_space_id)';
  execute 'alter table public.definition_tests enable row level security';
  execute 'revoke all on public.definition_tests from anon, authenticated';
  execute 'grant select, insert, delete on public.definition_tests to authenticated';
  -- No update grant and no update policy: last_* move only through
  -- the service role (the settle), never through a member's session.
  execute 'drop policy if exists definition_tests_select on public.definition_tests';
  execute $p$
    create policy definition_tests_select on public.definition_tests
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  execute 'drop policy if exists definition_tests_insert on public.definition_tests';
  execute $p$
    create policy definition_tests_insert on public.definition_tests
      for insert to authenticated
      with check (public.is_activity_space_member(activity_space_id) and captured_by = (select auth.uid()))
  $p$;
  execute 'drop policy if exists definition_tests_delete on public.definition_tests';
  execute $p$
    create policy definition_tests_delete on public.definition_tests
      for delete to authenticated
      using (captured_by = (select auth.uid()) or public.is_activity_space_owner(activity_space_id))
  $p$;

  -- ── The settle's notification ───────────────────────────────────
  -- A finished test run notifies the person who launched it, and
  -- nobody else (a test's result is the launcher's evidence, not the
  -- Space's news). The kind joins the Inbox's list the way B12's
  -- 'question' did: the constraint is restated whole, as a superset,
  -- and the row names the test it is about.
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications add column if not exists definition_test_id uuid references public.definition_tests(id) on delete set null';
    execute 'create index if not exists notifications_definition_test_idx on public.notifications (definition_test_id) where definition_test_id is not null';
    execute 'alter table public.notifications drop constraint if exists notifications_kind_check';
    execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
      || '''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested'','
      || '''approval_decided'', ''due_soon'', ''review_due'', ''invite'', ''asset_announced'','
      || '''measure_missed'', ''heartbeat'', ''promotion'', ''question'', ''definition_test'''
      || ']::text[]))';
  end if;
end $$;
