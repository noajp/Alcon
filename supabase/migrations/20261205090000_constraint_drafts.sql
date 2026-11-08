-- The learning edge (back-half program B6): constraint drafts,
-- activation, landing, effect measurement.
--
-- Outcomes (B4) say what happened; calibration (B5) says where the
-- verifier and the humans disagree. Neither changes what runs next —
-- a verdict that changes nothing is a report. This piece closes the
-- long return path: the automations tick clusters trailing outcomes
-- by (target, failure signature); a model may phrase ONE candidate
-- constraint per cluster (drafting only — it cannot set hashes,
-- evidence or state); code writes the draft; a Space owner activates
-- it through the hash-bound RPC; and the activated constraint lands
-- where future work is cut — the planner's brief and the Strategy
-- conversation (strategy scope), the definition's effective body at
-- resolution (definition scope). Its effect is then measured against
-- the baseline it claimed it would move, and a constraint that does
-- not move it is flagged ineffective — never auto-retired: retiring
-- is a person's call, because a flat rate can mean the metric, not
-- the constraint, is wrong.
--
--   constraint_drafts     the queue. Mirrors promotion_drafts'
--                         discipline: states, 7-day review expiry,
--                         one open draft per target, evidence
--                         attached, two hashes (structure: text +
--                         scope; binding: target + target version +
--                         the connector set the evidence spans) and
--                         the target snapshot the activation RPC
--                         compares against the live target — a
--                         definition edited after drafting refuses
--                         activation, never a silent landing on a
--                         body that no longer exists.
--   planning_constraints  the truth for activated constraints.
--                         Strategies gain planner_constraints jsonb
--                         as the append-only projection of their
--                         activations; the definition landing is a
--                         computed projection at resolution time.
--                         Neither rewrites anything a person wrote.
--   run_outcomes          + evidence jsonb: the collector records
--                         the ids of the constraints a run ran under
--                         (B4's shape, extended here as the design
--                         assigns to B6's migration), so the effect
--                         evaluator can attribute later outcomes to
--                         the constraint that governed them.
--
-- Activation and deactivation are owner-only, checked inside the
-- RPCs (the D1 posture), never merely in a UI. Nobody writes either
-- table through a policy: the tick's derivation (service role)
-- writes drafts, the RPCs decide them.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.run_outcomes') is null
     or to_regclass('public.definitions') is null
     or to_regclass('public.strategies') is null
     or to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'constraint drafts skipped: run_outcomes, definitions, strategies, activity_spaces or space role functions not present';
    return;
  end if;

  -- ── The outcome evidence block (B4's shape, B6's addition) ──────
  execute 'alter table public.run_outcomes add column if not exists evidence jsonb not null default ''{}''::jsonb';

  -- ── The Strategy landing projection ─────────────────────────────
  execute 'alter table public.strategies add column if not exists planner_constraints jsonb not null default ''[]''::jsonb';

  -- ── The draft queue ─────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.constraint_drafts (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      scope text not null check (scope in ('definition', 'strategy')),
      target_definition_id uuid references public.definitions(id) on delete set null,
      target_strategy_id uuid references public.strategies(id) on delete set null,
      constraint_text text,
      derived_from text not null check (derived_from in ('verifier_gap', 'rejection_cluster', 'correction_pattern')),
      signature text not null,
      evidence_outcome_ids uuid[] not null default '{}',
      cluster jsonb not null default '{}'::jsonb,
      calibration_candidate_id uuid references public.definition_revision_candidates(id) on delete set null,
      structure_hash text,
      binding_hash text,
      target_version text,
      target_snapshot text,
      status text not null default 'awaiting_review' check (status in ('draft', 'awaiting_review', 'activated', 'rejected', 'expired')),
      offered_at timestamptz,
      decided_by uuid,
      decided_at timestamptz,
      activated_constraint_id uuid,
      events jsonb not null default '[]'::jsonb,
      expires_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check ((scope = 'definition' and target_definition_id is not null and target_strategy_id is null)
          or (scope = 'strategy' and target_strategy_id is not null and target_definition_id is null))
    )
  $ddl$;
  execute 'create index if not exists constraint_drafts_space_idx on public.constraint_drafts (activity_space_id, status, created_at)';
  -- One open draft per target (the promotion pattern): a second
  -- lesson for the same target waits its turn instead of rivalling
  -- the one under review.
  execute 'create unique index if not exists constraint_drafts_one_open_definition on public.constraint_drafts (target_definition_id) where target_definition_id is not null and status in (''draft'', ''awaiting_review'')';
  execute 'create unique index if not exists constraint_drafts_one_open_strategy on public.constraint_drafts (target_strategy_id) where target_strategy_id is not null and status in (''draft'', ''awaiting_review'')';

  execute 'alter table public.constraint_drafts enable row level security';
  execute 'drop policy if exists constraint_drafts_select on public.constraint_drafts';
  execute $p$
    create policy constraint_drafts_select on public.constraint_drafts
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No insert / update / delete policy: the derivation (service
  -- role) writes drafts; a person decides them only through the
  -- owner-checked RPCs below.

  -- ── The activated truth ─────────────────────────────────────────
  execute $ddl$
    create table if not exists public.planning_constraints (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      scope text not null check (scope in ('definition', 'strategy')),
      target_definition_id uuid references public.definitions(id) on delete set null,
      target_strategy_id uuid references public.strategies(id) on delete set null,
      constraint_text text not null,
      draft_id uuid not null references public.constraint_drafts(id) on delete cascade,
      signature text not null,
      derived_from text not null check (derived_from in ('verifier_gap', 'rejection_cluster', 'correction_pattern')),
      baseline_rate double precision not null,
      baseline_outcomes integer not null,
      baseline_with integer not null,
      effect_status text not null default 'measuring' check (effect_status in ('measuring', 'improving', 'established', 'ineffective')),
      effect jsonb not null default '{}'::jsonb,
      status text not null default 'active' check (status in ('active', 'retired')),
      activated_by uuid not null,
      activated_at timestamptz not null default now(),
      retired_by uuid,
      retired_at timestamptz,
      retire_reason text check (retire_reason is null or retire_reason in ('owner', 'folded')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check ((scope = 'definition' and target_definition_id is not null and target_strategy_id is null)
          or (scope = 'strategy' and target_strategy_id is not null and target_definition_id is null))
    )
  $ddl$;
  execute 'create index if not exists planning_constraints_space_idx on public.planning_constraints (activity_space_id, status)';
  execute 'create index if not exists planning_constraints_definition_idx on public.planning_constraints (target_definition_id) where target_definition_id is not null';
  execute 'create index if not exists planning_constraints_strategy_idx on public.planning_constraints (target_strategy_id) where target_strategy_id is not null';
  -- One active constraint per (target, signature): the same failure
  -- mode cannot be governed twice at once.
  execute 'create unique index if not exists planning_constraints_one_active_definition on public.planning_constraints (target_definition_id, signature) where target_definition_id is not null and status = ''active''';
  execute 'create unique index if not exists planning_constraints_one_active_strategy on public.planning_constraints (target_strategy_id, signature) where target_strategy_id is not null and status = ''active''';
  -- The draft's landing, named back (the FK arrives once both tables
  -- stand, the G4 order: the table first, its joins after).
  execute 'alter table public.constraint_drafts drop constraint if exists constraint_drafts_activated_fk';
  execute 'alter table public.constraint_drafts add constraint constraint_drafts_activated_fk foreign key (activated_constraint_id) references public.planning_constraints(id) on delete set null';

  execute 'alter table public.planning_constraints enable row level security';
  execute 'drop policy if exists planning_constraints_select on public.planning_constraints';
  execute $p$
    create policy planning_constraints_select on public.planning_constraints
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No insert / update / delete policy: activation is the RPC's act,
  -- effect measurement is the tick evaluator's (service role).

  -- ── Activation: the stored-trust gate ───────────────────────────
  execute $ddl$
    create or replace function public.activate_constraint_draft(p_draft_id uuid)
    returns uuid
    language plpgsql
    security definer
    set search_path = public
    as $f$
    declare
      v_draft public.constraint_drafts%rowtype;
      v_constraint uuid;
      v_now timestamptz := now();
      v_baseline double precision;
    begin
      select * into v_draft from public.constraint_drafts where id = p_draft_id for update;
      if not found then
        raise exception 'constraint draft not found' using errcode = 'P0002';
      end if;
      -- Activation is the owner's act, checked here and not in any
      -- UI (the D1 posture): an activated constraint steers every
      -- future run of its target, so its governance matches its
      -- blast radius.
      if not public.is_activity_space_owner(v_draft.activity_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if v_draft.status <> 'awaiting_review' then
        raise exception 'このドラフトは審査待ちではありません';
      end if;
      if v_draft.expires_at is not null and v_draft.expires_at < v_now then
        raise exception '審査の期限が切れています';
      end if;
      if v_draft.constraint_text is null or v_draft.structure_hash is null or v_draft.binding_hash is null then
        raise exception '起草された制約が記録されていません';
      end if;

      -- The target must still be what the lesson was derived
      -- against. The snapshot the derivation stamped is compared
      -- here, in the RPC itself: an edit after drafting refuses the
      -- activation — never a silent landing on a body that no
      -- longer exists (the promotion pattern, decision 8's twin).
      if v_draft.scope = 'definition' then
        if v_draft.target_definition_id is null then
          raise exception '対象の定義が見つかりません';
        end if;
        if not exists (
          select 1 from public.definitions d
          where d.id = v_draft.target_definition_id
            and d.body is not distinct from v_draft.target_snapshot
        ) then
          raise exception '対象の定義が起草後に編集されています。黙って適用はしません。内容を確認し、却下して起草し直してください';
        end if;
      else
        if v_draft.target_strategy_id is null then
          raise exception '対象の Strategy が見つかりません';
        end if;
        if not exists (
          select 1 from public.strategies s
          where s.id = v_draft.target_strategy_id
            and (s.name || E'\n' || coalesce(s.description, '')) is not distinct from v_draft.target_snapshot
        ) then
          raise exception '対象の Strategy が起草後に編集されています。黙って適用はしません。内容を確認し、却下して起草し直してください';
        end if;
      end if;

      v_baseline := coalesce((v_draft.cluster ->> 'baselineRate')::double precision, 0);

      insert into public.planning_constraints (
        activity_space_id, scope, target_definition_id, target_strategy_id,
        constraint_text, draft_id, signature, derived_from,
        baseline_rate, baseline_outcomes, baseline_with, activated_by, activated_at)
      values (
        v_draft.activity_space_id, v_draft.scope, v_draft.target_definition_id, v_draft.target_strategy_id,
        v_draft.constraint_text, v_draft.id, v_draft.signature, v_draft.derived_from,
        v_baseline,
        coalesce((v_draft.cluster ->> 'windowOutcomes')::integer, 0),
        coalesce((v_draft.cluster ->> 'withSignature')::integer, 0),
        (select auth.uid()), v_now)
      returning id into v_constraint;

      -- The Strategy landing projection: the activation record is
      -- appended to the Strategy's own row, append-only, carrying
      -- its draft id — the record a person opening the Strategy
      -- sees, while planning_constraints stays the truth.
      if v_draft.scope = 'strategy' then
        update public.strategies s
           set planner_constraints = s.planner_constraints || jsonb_build_array(jsonb_build_object(
             'constraint_id', v_constraint,
             'draft_id', v_draft.id,
             'text', v_draft.constraint_text,
             'signature', v_draft.signature,
             'derived_from', v_draft.derived_from,
             'status', 'active',
             'activated_at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
             'activated_by', (select auth.uid())))
         where s.id = v_draft.target_strategy_id;
      end if;

      update public.constraint_drafts set
        status = 'activated', activated_constraint_id = v_constraint,
        decided_by = (select auth.uid()), decided_at = v_now, expires_at = null,
        events = events || jsonb_build_array(jsonb_build_object(
          'at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'kind', 'activated', 'by', (select auth.uid()))),
        updated_at = v_now
      where id = v_draft.id;
      return v_constraint;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.activate_constraint_draft(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.activate_constraint_draft(uuid) to authenticated';

  execute $ddl$
    create or replace function public.reject_constraint_draft(p_draft_id uuid)
    returns boolean
    language plpgsql
    security definer
    set search_path = public
    as $f$
    declare
      v_draft public.constraint_drafts%rowtype;
      v_now timestamptz := now();
    begin
      select * into v_draft from public.constraint_drafts where id = p_draft_id for update;
      if not found then
        raise exception 'constraint draft not found' using errcode = 'P0002';
      end if;
      if not public.is_activity_space_owner(v_draft.activity_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if v_draft.status not in ('draft', 'awaiting_review') then
        raise exception 'このドラフトは却下できる状態ではありません';
      end if;
      update public.constraint_drafts set
        status = 'rejected', decided_by = (select auth.uid()), decided_at = v_now,
        expires_at = null,
        events = events || jsonb_build_array(jsonb_build_object(
          'at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'kind', 'rejected', 'by', (select auth.uid()))),
        updated_at = v_now
      where id = v_draft.id;
      return true;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.reject_constraint_draft(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.reject_constraint_draft(uuid) to authenticated';

  -- ── Retirement: a person's call, never the measurement's ────────
  execute $ddl$
    create or replace function public.deactivate_planning_constraint(
      p_constraint_id uuid,
      p_reason text default 'owner'
    )
    returns boolean
    language plpgsql
    security definer
    set search_path = public
    as $f$
    declare
      v_con public.planning_constraints%rowtype;
      v_now timestamptz := now();
    begin
      if p_reason is not null and p_reason not in ('owner', 'folded') then
        raise exception 'retire reason must be owner or folded' using errcode = '22023';
      end if;
      select * into v_con from public.planning_constraints where id = p_constraint_id for update;
      if not found then
        raise exception 'planning constraint not found' using errcode = 'P0002';
      end if;
      if not public.is_activity_space_owner(v_con.activity_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if v_con.status <> 'active' then
        return false;
      end if;
      update public.planning_constraints set
        status = 'retired', retired_by = (select auth.uid()), retired_at = v_now,
        retire_reason = coalesce(p_reason, 'owner'), updated_at = v_now
      where id = v_con.id;
      -- The Strategy's projection follows: the record stays (the
      -- array is append-only history), its status moves to retired.
      if v_con.scope = 'strategy' and v_con.target_strategy_id is not null then
        update public.strategies s
           set planner_constraints = coalesce((
             select jsonb_agg(
               case when (elem ->> 'constraint_id') = v_con.id::text
                 then elem || jsonb_build_object(
                   'status', 'retired',
                   'retired_at', to_char(v_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
                 else elem end
               order by ord)
             from jsonb_array_elements(s.planner_constraints) with ordinality as e(elem, ord)
           ), '[]'::jsonb)
         where s.id = v_con.target_strategy_id;
      end if;
      return true;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.deactivate_planning_constraint(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.deactivate_planning_constraint(uuid, text) to authenticated';
end
$$;
