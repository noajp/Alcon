-- Verifier calibration (back-half program B5): grade the grader.
--
-- B4's outcome records pair what the machine judged (a run's sealed
-- verdict) with what the human eventually did (the signal filled once
-- from real acts). B5 reads those pairs per definition over a trailing
-- 28 days and asks whether the verifier and the human systematically
-- disagree — and where they do, treats the DEFINITION as the suspect
-- and queues it for a person's revision. Nothing here revises a
-- definition, loosens a check or speaks to a run: measurement and a
-- queue, written by the automations tick's evaluator
-- (_shared/verifierCalibration.ts), never by a model.
--
--   verifier_calibration        the rollup: one row per definition
--                               per window bucket, holding the pair
--                               counts (agree_pass / agree_fail /
--                               false_pass / false_fail / pairs).
--                               Refreshed by recomputation from
--                               run_outcomes, never hand-written.
--   definition_revision_candidates
--                               the queue. A row is a claim with a
--                               lifecycle (open → dismissed |
--                               addressed) that a refreshed rollup
--                               cannot hold — the reason this piece
--                               needs a table of its own. At most one
--                               OPEN candidate per definition (the
--                               partial unique index below). Written
--                               only by the tick evaluator; a person
--                               resolves one only through the RPC.
--   resolve_revision_candidate  the person's answer: owner-only
--                               (checked inside, the D1 posture),
--                               open → dismissed | addressed, nothing
--                               else about the row may move.
--
-- Pairs are counted only where BOTH sides spoke: a checked verdict
-- (pass / fail — an 'unchecked' finish was never judged, so it can
-- never enter calibration) and a human signal (accepted / rejected /
-- rework — 'none' is absence, not a judgement).
--
-- Reads follow the definition's visibility: Space members read both
-- tables of their Space. Nobody writes either table through a policy.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.run_outcomes') is null
     or to_regclass('public.definitions') is null
     or to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'verifier calibration skipped: run_outcomes, definitions, activity_spaces or space role functions not present';
    return;
  end if;

  -- ── The rollup ────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.verifier_calibration (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      definition_id uuid not null references public.definitions(id) on delete cascade,
      window_start timestamptz not null,
      window_days integer not null,
      agree_pass integer not null default 0,
      agree_fail integer not null default 0,
      false_pass integer not null default 0,
      false_fail integer not null default 0,
      pairs integer not null default 0,
      updated_at timestamptz not null default now(),
      unique (activity_space_id, definition_id, window_start, window_days)
    )
  $ddl$;
  execute 'create index if not exists verifier_calibration_definition_idx on public.verifier_calibration (definition_id, window_start desc)';

  execute 'alter table public.verifier_calibration enable row level security';
  execute 'drop policy if exists verifier_calibration_select on public.verifier_calibration';
  execute $p$
    create policy verifier_calibration_select on public.verifier_calibration
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No insert / update / delete policy: the tick evaluator (service
  -- role) is the only writer, so calibration can never be authored
  -- by a person or by the model whose verdicts it grades.

  -- ── The revision queue ────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.definition_revision_candidates (
      id uuid primary key default gen_random_uuid(),
      definition_id uuid not null references public.definitions(id) on delete cascade,
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      reason text not null check (reason in ('false_pass_heavy', 'false_fail_heavy', 'gap_cluster')),
      rate double precision not null,
      pairs integer not null,
      sample_outcome_ids uuid[] not null default '{}',
      status text not null default 'open' check (status in ('open', 'dismissed', 'addressed')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists definition_revision_candidates_space_idx on public.definition_revision_candidates (activity_space_id, status, created_at)';
  -- One open candidate per definition: the evaluator refreshes the
  -- open row as the window moves; a second open row for the same
  -- definition would be a second queue entry for one claim.
  execute 'create unique index if not exists definition_revision_candidates_open_idx on public.definition_revision_candidates (definition_id) where status = ''open''';

  execute 'alter table public.definition_revision_candidates enable row level security';
  execute 'drop policy if exists definition_revision_candidates_select on public.definition_revision_candidates';
  execute $p$
    create policy definition_revision_candidates_select on public.definition_revision_candidates
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No insert / update / delete policy: the evaluator opens and
  -- refreshes candidates (service role); a person resolves one only
  -- through resolve_revision_candidate below.

  -- ── The person's answer ───────────────────────────────────────────
  execute $ddl$
    create or replace function public.resolve_revision_candidate(
      p_candidate_id uuid,
      p_status text
    )
    returns text
    language plpgsql
    security definer
    set search_path = public
    as $f$
    declare
      v_cand public.definition_revision_candidates%rowtype;
    begin
      if p_status not in ('dismissed', 'addressed') then
        raise exception 'a candidate is resolved as dismissed or addressed' using errcode = '22023';
      end if;
      select * into v_cand from public.definition_revision_candidates where id = p_candidate_id for update;
      if not found then
        raise exception 'revision candidate not found' using errcode = 'P0002';
      end if;
      -- Resolving the queue is the owner's act: the candidate accuses
      -- a definition the Space's work follows, so its governance
      -- matches its blast radius (the D1 posture, checked here and
      -- not in any UI).
      if not public.is_activity_space_owner(v_cand.activity_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if v_cand.status <> 'open' then
        return v_cand.status;
      end if;
      update public.definition_revision_candidates
         set status = p_status, updated_at = now()
       where id = p_candidate_id;
      return p_status;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.resolve_revision_candidate(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.resolve_revision_candidate(uuid, text) to authenticated';
end
$$;
