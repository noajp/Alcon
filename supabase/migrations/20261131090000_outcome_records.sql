-- Outcome records: the measurement foundation (back-half program B4).
--
-- Every finished run leaves one outcome record that pairs what the
-- machine judged with what the human eventually did — the dataset the
-- learning edge (B6), verifier calibration (B5) and graduated autonomy
-- (B7) consume. Nothing here changes any behavior: this is
-- instrumentation with the discipline of a code node — deterministic,
-- derived from source-of-truth rows, written only by the service role
-- (the automations tick's collector, _shared/outcomeCollector.ts).
--
--   run_outcomes    one row per run (run_id unique). The machine half —
--                   driver, definition, finish outcome, verdict,
--                   revisions, cost, approval counts, readings counts —
--                   is derived from the run's sealed record. The human
--                   block (human_signal / signal_source / signal_at /
--                   signal_by) is filled ONCE from the first source, in
--                   the design's strength order, that speaks: an approval
--                   rejection, an acceptance, a review send-back, a
--                   reopen, a promotion rollback. 'none' is a value,
--                   never back-filled with an inference — absence is
--                   represented, not filled.
--   outcome_rollups refreshed counts per scope (definition |
--                   connector_command | space) over trailing day-bucketed
--                   windows (7d / 28d), recomputed by the collector from
--                   run_outcomes — refreshed, never hand-written.
--
-- Reads follow the run's visibility: a person who can see the Element
-- can see its runs' outcomes; Space members can read their Space's
-- rollups. Nobody writes either table directly.
--
-- Guarded for preview replay: each part checks what it touches first.
do $$
declare
  has_runs boolean := to_regclass('public.agent_runs') is not null;
  has_spaces boolean := to_regclass('public.activity_spaces') is not null;
  has_elements boolean := to_regclass('public.elements') is not null;
  has_definitions boolean := to_regclass('public.definitions') is not null;
  has_strategies boolean := to_regclass('public.strategies') is not null;
  has_see_element boolean := to_regprocedure('public.user_can_see_element(uuid)') is not null;
  has_member boolean := to_regprocedure('public.is_activity_space_member(uuid)') is not null;
begin
  if not has_runs or not has_spaces then
    raise notice 'outcome records skipped: agent_runs / activity_spaces not present';
    return;
  end if;

  -- ── The store ───────────────────────────────────────────────────────
  create table if not exists public.run_outcomes (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null unique references public.agent_runs(id) on delete cascade,
    element_id uuid,
    strategy_id uuid,
    activity_space_id uuid references public.activity_spaces(id) on delete cascade,
    driver text not null,
    definition_id uuid,
    definition_version integer,
    outcome text check (outcome is null or outcome in ('completed', 'partial', 'blocked')),
    verdict_result text check (verdict_result is null or verdict_result in ('pass', 'fail', 'unchecked')),
    verdict_reason text,
    revisions integer not null default 0,
    cost_usd numeric(12, 6) not null default 0,
    approvals_asked integer not null default 0,
    approvals_approved integer not null default 0,
    approvals_rejected integer not null default 0,
    approvals_policy integer not null default 0,
    readings_applied integer not null default 0,
    readings_held integer not null default 0,
    finished_at timestamptz not null,
    human_signal text not null default 'none' check (human_signal in ('accepted', 'rejected', 'rework', 'none')),
    signal_source text check (signal_source is null or signal_source in ('approval', 'acceptance', 'reopen', 'rollback', 'review')),
    signal_at timestamptz,
    signal_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists run_outcomes_space_finished_idx on public.run_outcomes (activity_space_id, finished_at desc);
  create index if not exists run_outcomes_definition_finished_idx on public.run_outcomes (definition_id, finished_at desc) where definition_id is not null;
  create index if not exists run_outcomes_element_idx on public.run_outcomes (element_id, finished_at desc) where element_id is not null;
  create index if not exists run_outcomes_unsignalled_idx on public.run_outcomes (finished_at) where human_signal = 'none';

  -- The target links keep no foreign key of their own in this guarded
  -- form; add them when their tables are present (an outcome outlives
  -- its Element the way a memory does — what was learned stays).
  if has_elements then
    execute 'alter table public.run_outcomes drop constraint if exists run_outcomes_element_fk';
    execute 'alter table public.run_outcomes add constraint run_outcomes_element_fk foreign key (element_id) references public.elements(id) on delete set null';
  end if;
  if has_definitions then
    execute 'alter table public.run_outcomes drop constraint if exists run_outcomes_definition_fk';
    execute 'alter table public.run_outcomes add constraint run_outcomes_definition_fk foreign key (definition_id) references public.definitions(id) on delete set null';
  end if;
  if has_strategies then
    execute 'alter table public.run_outcomes drop constraint if exists run_outcomes_strategy_fk';
    execute 'alter table public.run_outcomes add constraint run_outcomes_strategy_fk foreign key (strategy_id) references public.strategies(id) on delete set null';
  end if;

  alter table public.run_outcomes enable row level security;
  drop policy if exists run_outcomes_select on public.run_outcomes;
  if has_see_element and has_member then
    execute $p$
      create policy run_outcomes_select on public.run_outcomes for select to authenticated using (
        (element_id is not null and public.user_can_see_element(element_id))
        or (activity_space_id is not null and public.is_activity_space_member(activity_space_id))
      )
    $p$;
  elsif has_see_element then
    execute $p$
      create policy run_outcomes_select on public.run_outcomes for select to authenticated using (
        element_id is not null and public.user_can_see_element(element_id)
      )
    $p$;
  end if;
  -- No insert / update / delete policy: the collector (service role)
  -- is the only writer, so an outcome can never be authored by a
  -- person or by the model whose work it judges.

  -- ── Rollups ─────────────────────────────────────────────────────────
  create table if not exists public.outcome_rollups (
    id uuid primary key default gen_random_uuid(),
    scope_kind text not null check (scope_kind in ('definition', 'connector_command', 'space')),
    scope_id text not null,
    window_start timestamptz not null,
    window_days integer not null,
    counts jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now(),
    unique (scope_kind, scope_id, window_start, window_days)
  );
  create index if not exists outcome_rollups_scope_idx on public.outcome_rollups (scope_kind, scope_id, window_start desc);

  alter table public.outcome_rollups enable row level security;
  drop policy if exists outcome_rollups_select on public.outcome_rollups;
  if has_member then
    execute $p$
      create policy outcome_rollups_select on public.outcome_rollups for select to authenticated using (
        scope_kind = 'space'
        and scope_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        and public.is_activity_space_member(scope_id::uuid)
      )
    $p$;
  end if;
  -- Definition and connector rollups are read by server consumers
  -- (calibration, track records) until their own drill-downs land;
  -- no policy grants them here, and nobody writes rollups directly.
end
$$;
