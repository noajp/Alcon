-- Compensation records (back-half program B9): when a run fails after
-- some of its writes landed, the landed writes are rolled back by the
-- undo each write's manifest command declared — or named, in the
-- failure report, as standing uncompensated. The undo payload is
-- resolved from the write's actual arguments and result at the moment
-- it lands and recorded here, bound: a failure at 3am is rolled back
-- (or judged) the next morning from this record, never from a
-- re-derivation against a manifest that may since have changed.
--
--   write_compensations  one row per landed write whose command
--                        declares an undo (kind 'write'), carrying the
--                        resolved undo arguments, the fields that
--                        could not be resolved, the write's verify
--                        outcome, and the compensation state machine
--                        (pending → compensating → compensated /
--                        compensation_failed / declined / reported).
--                        A compensation's own execution leaves a
--                        kind 'compensation' row pointing back at the
--                        row it compensates — the rollback is itself
--                        on the record, and a compensation never
--                        earns a compensation of its own.
--
-- This table exists because agent_actions cannot serve: that table
-- holds only approval-shaped records, so a write that ran unasked
-- under an allow verdict or full delegation — exactly the contained
-- lane-1 writes likeliest to declare an undo — leaves no row there.
-- The record was kept, as B11 kept its call log, instead of narrowing
-- the rule to the writes that happen to be recorded.
--
-- agent_actions.decision_source learns 'compensation': the dedicated
-- row a compensation pass writes for an undo it runs unasked is born
-- approved under that source (the B7 'track-record' / B8 'plan'
-- precedent — a small guarded constraint extension, no new table).
--
-- Reads: Space members read their Space's rows (the audit drill-down
-- and any future surface). No write policy at all: the engine
-- (service role) is the only writer, so a payload or an outcome can
-- never be authored by a person or by the model whose writes are
-- recorded. Rows are audit: no TTL, like agent_actions.
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
    raise notice 'write compensations skipped: activity_spaces, agent_runs, agent_actions, integrations, elements or is_activity_space_member not present';
    return;
  end if;

  -- ── The compensation record ─────────────────────────────────────
  execute $ddl$
    create table if not exists public.write_compensations (
      id uuid primary key default gen_random_uuid(),
      seq bigint generated always as identity,
      run_id uuid not null references public.agent_runs(id) on delete cascade,
      activity_space_id uuid references public.activity_spaces(id) on delete cascade,
      element_id uuid references public.elements(id) on delete set null,
      integration_id uuid not null references public.integrations(id) on delete cascade,
      command_name text not null,
      tool_use_id text not null,
      target_key text,
      undo_command_name text not null,
      undo_input jsonb not null,
      unresolved jsonb not null default '[]',
      verify_status text check (verify_status in ('ok', 'mismatch', 'unverified')),
      kind text not null default 'write' check (kind in ('write', 'compensation')),
      compensates_id uuid references public.write_compensations(id) on delete set null,
      status text not null default 'pending'
        check (status in ('pending', 'compensating', 'compensated', 'compensation_failed', 'declined', 'reported')),
      status_reason text,
      created_at timestamptz not null default now(),
      settled_at timestamptz
    )
  $ddl$;
  execute 'create index if not exists write_compensations_run_idx on public.write_compensations (run_id, seq)';

  execute 'alter table public.write_compensations enable row level security';
  execute 'drop policy if exists write_compensations_select on public.write_compensations';
  execute $p$
    create policy write_compensations_select on public.write_compensations
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No write policy: the engine writes payloads at the execution seam
  -- and settles them in the compensation pass, both service role.

  -- ── decision_source learns 'compensation' ───────────────────────
  execute 'alter table public.agent_actions drop constraint if exists agent_actions_decision_source_check';
  execute 'alter table public.agent_actions add constraint agent_actions_decision_source_check check (decision_source is null or decision_source in (''policy'', ''track-record'', ''plan'', ''compensation''))';
end
$$;
