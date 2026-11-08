-- Graduated autonomy (back-half program B7): track-record lanes over
-- the static approval modes. "Ask every time" and "full delegation"
-- stop being the only two speeds: per connector × command, a clean
-- track record — computed by code from B4's outcome records and the
-- action rows beneath them — earns fewer asks inside a blast-radius
-- lane, and a single incident takes them back. The static modes stay
-- the Space's ceiling; the floors do not move (deny denies, critical
-- asks, ask-every-time asks — the gate composes the grant as one
-- pre-computed fact, _shared/autonomy.ts + approvalPolicy.ts).
--
--   command_track_records  the rollup: one row per (Space,
--                          integration, action) per window bucket —
--                          the counts the promotion rule reads.
--                          Refreshed by recomputation from sealed
--                          rows on the automations tick, never
--                          hand-written.
--   autonomy_grants        the standing fact: one row per (Space,
--                          integration, action) — its lane, its level
--                          (ask | auto), the basis counts it stands
--                          on, who granted it (system | owner),
--                          whether an owner pinned the level, the
--                          clean streak its next promotion requires
--                          (doubled by a demotion — the system's
--                          memory of being wrong is longer), and the
--                          last incident that touched it. Written by
--                          the tick evaluator, by the synchronous
--                          demotion paths (a rejection, a verify
--                          mismatch — service role), and by the pin
--                          RPC below (owners). Nobody else.
--   autonomy_changes       the level's history, mirroring
--                          space_approval_mode_changes: every move a
--                          grant makes, with its cause and the
--                          incident or counts behind it.
--   set_autonomy_pin       the owner's one control: freeze a
--                          command's level (ask or auto), or unpin
--                          it back to the system's judgement.
--                          Owner-only, checked inside.
--
-- agent_actions.decision_source learns 'track-record': a call that
-- ran unasked on an earned grant leaves the same policy-approval
-- record a free-mode lift leaves, with the source naming the grant —
-- the audit distinction between "the Space said always" (policy) and
-- "this action earned it" (track-record) is preserved on the row.
--
-- Reads follow the Space: members read all three tables of their
-- Space. No insert / update / delete policy on any of them.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.integrations') is null
     or to_regclass('public.agent_actions') is null
     or to_regclass('public.run_outcomes') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'graduated autonomy skipped: activity_spaces, integrations, agent_actions, run_outcomes or space role functions not present';
    return;
  end if;

  -- ── Who decided an action: a person, the mode, or a track record ──
  execute 'alter table public.agent_actions drop constraint if exists agent_actions_decision_source_check';
  execute 'alter table public.agent_actions add constraint agent_actions_decision_source_check check (decision_source is null or decision_source in (''policy'', ''track-record''))';

  -- ── The track-record rollup ───────────────────────────────────────
  execute $ddl$
    create table if not exists public.command_track_records (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      integration_id uuid not null references public.integrations(id) on delete cascade,
      action text not null,
      window_start timestamptz not null,
      window_days integer not null,
      clean_completions integer not null default 0,
      checked_passes integer not null default 0,
      clean_streak integer not null default 0,
      checked_in_streak integer not null default 0,
      verify_checked integer not null default 0,
      verify_ok integer not null default 0,
      verify_green_streak integer not null default 0,
      incidents integer not null default 0,
      last_incident_at timestamptz,
      updated_at timestamptz not null default now(),
      unique (activity_space_id, integration_id, action, window_start, window_days)
    )
  $ddl$;
  execute 'create index if not exists command_track_records_space_idx on public.command_track_records (activity_space_id, window_start desc)';

  execute 'alter table public.command_track_records enable row level security';
  execute 'drop policy if exists command_track_records_select on public.command_track_records';
  execute $p$
    create policy command_track_records_select on public.command_track_records
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No write policy: the tick evaluator (service role) is the only
  -- writer, so a track record can never be authored by a person or by
  -- the model whose calls it counts.

  -- ── The grants ────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.autonomy_grants (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      integration_id uuid not null references public.integrations(id) on delete cascade,
      action text not null,
      lane integer not null check (lane in (1, 2, 3)),
      level text not null default 'ask' check (level in ('ask', 'auto')),
      basis jsonb not null default '{}',
      granted_by text not null default 'system' check (granted_by in ('system', 'owner')),
      pinned boolean not null default false,
      required_clean integer not null default 0,
      last_incident_at timestamptz,
      last_incident_kind text check (last_incident_kind is null or last_incident_kind in ('rejection', 'verify_mismatch', 'reopen', 'rollback', 'verdict_fail', 'record_lapsed', 'lane_closed')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (activity_space_id, integration_id, action)
    )
  $ddl$;
  execute 'create index if not exists autonomy_grants_space_idx on public.autonomy_grants (activity_space_id, level)';

  execute 'alter table public.autonomy_grants enable row level security';
  execute 'drop policy if exists autonomy_grants_select on public.autonomy_grants';
  execute $p$
    create policy autonomy_grants_select on public.autonomy_grants
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No write policy: the evaluator, the demotion paths and the pin
  -- RPC are the only writers.

  -- ── The history of level changes ──────────────────────────────────
  execute $ddl$
    create table if not exists public.autonomy_changes (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      integration_id uuid not null references public.integrations(id) on delete cascade,
      action text not null,
      from_level text check (from_level is null or from_level in ('ask', 'auto')),
      to_level text not null check (to_level in ('ask', 'auto')),
      cause text not null check (cause in ('promotion', 'demotion', 'pin', 'unpin')),
      detail jsonb not null default '{}',
      changed_by uuid,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists autonomy_changes_space_idx on public.autonomy_changes (activity_space_id, created_at desc)';

  execute 'alter table public.autonomy_changes enable row level security';
  execute 'drop policy if exists autonomy_changes_select on public.autonomy_changes';
  execute $p$
    create policy autonomy_changes_select on public.autonomy_changes
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $p$;
  -- No write policy: a history row always names a change that
  -- actually happened, written in the same act as the change.

  -- ── The owner's one control: pin / unpin ──────────────────────────
  execute $f$
  create or replace function public.set_autonomy_pin(
    p_space_id uuid,
    p_integration_id uuid,
    p_action text,
    p_level text
  )
  returns text language plpgsql security definer set search_path = public as $body$
  declare
    v_integration public.integrations%rowtype;
    v_command jsonb;
    v_lane integer := 2;
    v_grant public.autonomy_grants%rowtype;
  begin
    if p_level is not null and p_level not in ('ask', 'auto') then
      raise exception 'unknown level: %', p_level using errcode = '22023';
    end if;
    -- Pinning is the owner's act, checked here and not in any UI.
    if not public.is_activity_space_owner(p_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    select * into v_integration from public.integrations
     where id = p_integration_id and activity_space_id = p_space_id;
    if not found then
      raise exception 'integration not found in this space' using errcode = 'P0002';
    end if;
    -- The command must be one the connection's manifest declares —
    -- a pin on an action that does not exist would be a standing
    -- approval over nothing, waiting for a name to collide with.
    select c into v_command from jsonb_array_elements(
      case when jsonb_typeof(v_integration.manifest -> 'commands') = 'array'
           then v_integration.manifest -> 'commands' else '[]'::jsonb end) c
     where c ->> 'name' = p_action limit 1;
    if v_command is null then
      raise exception 'command not found: %', p_action using errcode = 'P0002';
    end if;
    -- The lane as the manifest declares it; undeclared writes stand
    -- in lane 2. This is bookkeeping for the settings screen — the
    -- gate derives the floors (critical, deny) from the live
    -- manifest itself and never trusts this column for them.
    v_lane := case
      when v_command ->> 'reversibility' = 'contained' then 1
      when v_command ->> 'reversibility' = 'none' then 3
      else 2
    end;

    select * into v_grant from public.autonomy_grants
     where activity_space_id = p_space_id and integration_id = p_integration_id and action = p_action
     for update;

    if p_level is null then
      -- Unpin: the level stays what it is; the system's judgement
      -- governs it from the next evaluation on.
      if not found or not v_grant.pinned then
        return coalesce(v_grant.level, 'none');
      end if;
      update public.autonomy_grants set pinned = false, updated_at = now() where id = v_grant.id;
      insert into public.autonomy_changes (activity_space_id, integration_id, action, from_level, to_level, cause, detail, changed_by)
        values (p_space_id, p_integration_id, p_action, v_grant.level, v_grant.level, 'unpin', '{}'::jsonb, (select auth.uid()));
      return v_grant.level;
    end if;

    if not found then
      insert into public.autonomy_grants
        (activity_space_id, integration_id, action, lane, level, basis, granted_by, pinned, required_clean)
        values (p_space_id, p_integration_id, p_action, v_lane, p_level, '{}'::jsonb, 'owner', true, 0)
        returning * into v_grant;
      insert into public.autonomy_changes (activity_space_id, integration_id, action, from_level, to_level, cause, detail, changed_by)
        values (p_space_id, p_integration_id, p_action, null, p_level, 'pin', '{}'::jsonb, (select auth.uid()));
      return p_level;
    end if;
    if v_grant.level = p_level and v_grant.pinned then return p_level; end if;
    update public.autonomy_grants
       set level = p_level, pinned = true, granted_by = 'owner', lane = v_lane, updated_at = now()
     where id = v_grant.id;
    insert into public.autonomy_changes (activity_space_id, integration_id, action, from_level, to_level, cause, detail, changed_by)
      values (p_space_id, p_integration_id, p_action, v_grant.level, p_level, 'pin', '{}'::jsonb, (select auth.uid()));
    return p_level;
  end
  $body$
  $f$;
  execute 'revoke all on function public.set_autonomy_pin(uuid, uuid, text, text) from public';
  execute 'grant execute on function public.set_autonomy_pin(uuid, uuid, text, text) to authenticated';
end
$$;
