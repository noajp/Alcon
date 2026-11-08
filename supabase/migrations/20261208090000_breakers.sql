-- Circuit breakers and manifest quotas (back-half program B11): the
-- harassment guard over a run's own call stream. Budgets stop
-- expensive runs; breakers stop *wrong* runs — repeated writes to one
-- target, a run whose calls mostly fail, a first-ever send to a
-- destination this Space has never written to. The rules are
-- deterministic code over settled call records (_shared/breakers.ts),
-- evaluated in the gate before the approval composition, so no mode,
-- delegation, standing rule or earned autonomy grant can lift a trip.
--
--   integration_call_log  the evidence: one row per manifest-command
--                         call the executor actually dispatched —
--                         reads and writes, landed or failed — written
--                         by the execute driver at the record stage
--                         (service role). It exists because
--                         agent_actions cannot serve: that table holds
--                         only approval-shaped records, so a write
--                         that ran unasked under an allow verdict or
--                         full delegation leaves no row there —
--                         exactly the traffic a harassment guard
--                         exists to see.
--   breaker_trips         the audit of a trip: one row per trip (run,
--                         rule, target, the window evidence it stood
--                         on, the one-line reason the run rests on),
--                         status open until a person's decision on the
--                         held batch acknowledges it. Nothing
--                         auto-resumes and nothing else acknowledges.
--
-- Reads: Space members read breaker_trips of their Space (the
-- heartbeat's candidate and any drill-down read it as a member). The
-- call log is engine bookkeeping — target keys can carry repository
-- paths and recipient addresses — so it has NO policy at all: only
-- the service role reads or writes it. No insert / update / delete
-- policy on either table: the engine (service role) is the only
-- writer, so a trip or a call record can never be authored by a
-- person or by the model whose calls are counted.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.agent_runs') is null
     or to_regclass('public.agent_actions') is null
     or to_regclass('public.integrations') is null
     or to_regclass('public.elements') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'circuit breakers skipped: activity_spaces, agent_runs, agent_actions, integrations, elements or is_activity_space_member not present';
    return;
  end if;

  -- ── The settled call record ─────────────────────────────────────
  execute $ddl$
    create table if not exists public.integration_call_log (
      id uuid primary key default gen_random_uuid(),
      seq bigint generated always as identity,
      run_id uuid not null references public.agent_runs(id) on delete cascade,
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      integration_id uuid not null references public.integrations(id) on delete cascade,
      command_name text not null,
      is_write boolean not null,
      ok boolean not null,
      target_key text,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists integration_call_log_target_idx on public.integration_call_log (activity_space_id, integration_id, target_key, created_at desc)';
  execute 'create index if not exists integration_call_log_run_idx on public.integration_call_log (run_id, seq desc)';

  execute 'alter table public.integration_call_log enable row level security';
  -- No policy, deliberately: engine bookkeeping, service role only.

  -- ── The trips ───────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.breaker_trips (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references public.agent_runs(id) on delete cascade,
      element_id uuid references public.elements(id) on delete set null,
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      action_id uuid references public.agent_actions(id) on delete set null,
      rule text not null check (rule in ('write_rate', 'error_rate', 'first_destination')),
      integration_id uuid references public.integrations(id) on delete set null,
      integration_name text not null,
      command_name text not null,
      target_key text,
      evidence jsonb not null default '{}',
      reason text not null,
      status text not null default 'open' check (status in ('open', 'acknowledged')),
      acknowledged_by uuid,
      acknowledged_at timestamptz,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists breaker_trips_space_idx on public.breaker_trips (activity_space_id, status, created_at)';
  execute 'create index if not exists breaker_trips_run_idx on public.breaker_trips (run_id, created_at)';

  execute 'alter table public.breaker_trips enable row level security';
  execute 'drop policy if exists breaker_trips_select on public.breaker_trips';
  execute $p$
    create policy breaker_trips_select on public.breaker_trips
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No write policy: the gate writes a trip in the same act that
  -- rests the run, and a decision acknowledges it — both service role.
end
$$;
