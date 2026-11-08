-- Heartbeat: Athena wakes on a cadence in a Space, inspects what has
-- been left waiting, and speaks only when there is something worth
-- saying. The wake is a run (mode 'heartbeat') whose subject is the
-- Space itself; this migration lays down everything the wake stands on:
--
--   activity_spaces.heartbeat_*   the Space's heartbeat: opt-in, the
--                   owner who enabled it (the wake acts as that person),
--                   the cadence, the next scheduled wake (the tick
--                   claims it the way it claims a schedule's
--                   next_run_at), quiet hours in the Space's timezone,
--                   the age a wait must reach before it is worth
--                   raising, and the heartbeat's own monthly sub-cap —
--                   a ceiling inside the Space's AI budget, so the
--                   housekeeping can never eat the work's budget.
--                   heartbeat_last_tick_at records when the tick last
--                   reached this Space's heartbeat section, so the
--                   settings screen can say whether the every-minute
--                   drive is arriving at all (the pg_cron registration
--                   itself is per-environment, as with automations).
--   agent_runs      mode 'heartbeat' joins the subject check — the
--                   Space is the subject, carried in activity_space_id
--                   itself, so every subject column stays null (the
--                   copilot mode branch is the precedent for a mode in
--                   the check). The select policy gains the matching
--                   branch: a heartbeat run's record belongs to the
--                   Space, and its members read it.
--   notifications   kind 'heartbeat' joins the kind check (restated
--                   whole, the standing style), and agent_run_id links
--                   a digest to the wake that sent it (the
--                   agent_action_id precedent).
--   set_space_heartbeat           the one way the settings change: an
--                   owner's act. Enabling names the caller as the
--                   wake's actor and schedules the first wake;
--                   disabling clears the schedule. Members read the
--                   settings; nobody edits the columns directly.
--
-- The heartbeat notifies only, in every approval mode: the mode a wake
-- starts under is snapshotted by the engine like any run's, but no
-- mode gives an unmanned wake an action to take.
--
-- Guarded for preview replay: each part checks what it touches first.
do $$
declare
  has_spaces boolean := to_regclass('public.activity_spaces') is not null;
  has_runs boolean := to_regclass('public.agent_runs') is not null;
  has_sessions boolean := to_regclass('public.ai_sessions') is not null;
  has_strategies boolean := to_regclass('public.strategies') is not null;
  has_notifications boolean := to_regclass('public.notifications') is not null;
  has_drafts boolean := to_regclass('public.integration_drafts') is not null;
  v_check text;
  v_using text;
begin
  if not has_spaces then
    raise notice 'heartbeat skipped: activity_spaces not present';
    return;
  end if;

  -- ── The Space's heartbeat settings ──────────────────────────────────
  execute 'alter table public.activity_spaces add column if not exists heartbeat_enabled boolean not null default false';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_owner_id uuid references auth.users(id) on delete set null';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_cadence_minutes integer not null default 60';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_next_at timestamptz';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_timezone text not null default ''Asia/Tokyo''';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_quiet_start time';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_quiet_end time';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_notify_after_hours numeric not null default 24';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_monthly_budget_usd numeric(10,2) not null default 2.00';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_last_wake_at timestamptz';
  execute 'alter table public.activity_spaces add column if not exists heartbeat_last_tick_at timestamptz';
  execute 'alter table public.activity_spaces drop constraint if exists activity_spaces_heartbeat_cadence_check';
  execute 'alter table public.activity_spaces add constraint activity_spaces_heartbeat_cadence_check check (heartbeat_cadence_minutes in (30, 60, 180, 360, 720, 1440))';
  execute 'alter table public.activity_spaces drop constraint if exists activity_spaces_heartbeat_threshold_check';
  execute 'alter table public.activity_spaces add constraint activity_spaces_heartbeat_threshold_check check (heartbeat_notify_after_hours > 0)';
  execute 'alter table public.activity_spaces drop constraint if exists activity_spaces_heartbeat_budget_check';
  execute 'alter table public.activity_spaces add constraint activity_spaces_heartbeat_budget_check check (heartbeat_monthly_budget_usd >= 0)';
  execute 'alter table public.activity_spaces drop constraint if exists activity_spaces_heartbeat_quiet_check';
  execute 'alter table public.activity_spaces add constraint activity_spaces_heartbeat_quiet_check check ((heartbeat_quiet_start is null) = (heartbeat_quiet_end is null))';
  execute 'create index if not exists activity_spaces_heartbeat_due_idx on public.activity_spaces (heartbeat_next_at) where heartbeat_enabled';
  execute 'grant select (heartbeat_enabled, heartbeat_owner_id, heartbeat_cadence_minutes, heartbeat_next_at, heartbeat_timezone, heartbeat_quiet_start, heartbeat_quiet_end, heartbeat_notify_after_hours, heartbeat_monthly_budget_usd, heartbeat_last_wake_at, heartbeat_last_tick_at) on public.activity_spaces to authenticated';

  -- ── agent_runs: the Space itself as the subject ─────────────────────
  if has_runs then
    v_check := 'element_id is not null'
      || case when has_strategies then ' or strategy_id is not null' else '' end
      || case when has_sessions then ' or ai_session_id is not null or mode = ''copilot''' else '' end
      || case when has_drafts then ' or integration_draft_id is not null' else '' end
      || ' or mode = ''heartbeat''';
    execute 'alter table public.agent_runs drop constraint if exists agent_runs_subject_check';
    execute 'alter table public.agent_runs add constraint agent_runs_subject_check check (' || v_check || ')';

    v_using := 'case when element_id is not null then public.user_can_read_element(element_id)'
      || case when has_strategies then ' when strategy_id is not null then exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id)' else '' end
      || case when has_sessions then ' when ai_session_id is not null or mode = ''copilot'' then triggered_by = (select auth.uid())' else '' end
      || case when has_drafts then ' when integration_draft_id is not null then exists (select 1 from public.integration_drafts d where d.id = agent_runs.integration_draft_id)' else '' end
      || ' when mode = ''heartbeat'' then public.is_activity_space_member(activity_space_id)'
      || ' else false end';
    execute 'drop policy if exists agent_runs_select on public.agent_runs';
    execute 'create policy agent_runs_select on public.agent_runs for select using (' || v_using || ')';
    -- Steps follow the run's select (20261115090000), so the wake's
    -- steps are the Space's record with no further policy. Inserts of
    -- heartbeat runs are the tick's and the wake-now path's, both
    -- service role; no insert branch is added for people.
  end if;

  -- ── notifications: the digest kind, and the wake it came from ───────
  if has_notifications then
    execute 'alter table public.notifications drop constraint if exists notifications_kind_check';
    execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array['
      || '''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested'','
      || '''approval_decided'', ''due_soon'', ''review_due'', ''invite'', ''asset_announced'','
      || '''measure_missed'', ''heartbeat'''
      || ']::text[]))';
    if has_runs then
      execute 'alter table public.notifications add column if not exists agent_run_id uuid references public.agent_runs(id) on delete set null';
      execute 'create index if not exists notifications_agent_run_idx on public.notifications (agent_run_id) where agent_run_id is not null';
    end if;
  end if;

  -- ── The one way the settings change ─────────────────────────────────
  execute $f$
  create or replace function public.set_space_heartbeat(
    p_space_id uuid, p_enabled boolean, p_cadence_minutes integer,
    p_notify_after_hours numeric, p_quiet_start time, p_quiet_end time,
    p_timezone text, p_monthly_budget_usd numeric)
  returns boolean language plpgsql security definer set search_path = public as $body$
  declare
    v_row public.activity_spaces%rowtype;
  begin
    if not public.is_activity_space_owner(p_space_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if p_cadence_minutes not in (30, 60, 180, 360, 720, 1440) then
      raise exception 'unknown heartbeat cadence: %', p_cadence_minutes;
    end if;
    if p_notify_after_hours is null or p_notify_after_hours <= 0 then
      raise exception 'the notify threshold must be positive';
    end if;
    if p_monthly_budget_usd is null or p_monthly_budget_usd < 0 then
      raise exception 'the heartbeat budget cannot be negative';
    end if;
    if (p_quiet_start is null) <> (p_quiet_end is null) then
      raise exception 'quiet hours need both a start and an end';
    end if;
    select * into v_row from public.activity_spaces where id = p_space_id for update;
    if v_row.id is null then raise exception 'space not found'; end if;

    if p_enabled then
      update public.activity_spaces set
        heartbeat_enabled = true,
        -- The person enabling it is the wake's actor. Taking the
        -- settings over as another owner re-names the actor to them:
        -- the move is this recorded act, never a silent drift.
        heartbeat_owner_id = (select auth.uid()),
        heartbeat_cadence_minutes = p_cadence_minutes,
        heartbeat_notify_after_hours = p_notify_after_hours,
        heartbeat_quiet_start = p_quiet_start,
        heartbeat_quiet_end = p_quiet_end,
        heartbeat_timezone = coalesce(nullif(p_timezone, ''), 'Asia/Tokyo'),
        heartbeat_monthly_budget_usd = p_monthly_budget_usd,
        -- A cadence change re-anchors the schedule on now; the tick
        -- advances it from the scheduled time from then on.
        heartbeat_next_at = now() + make_interval(mins => p_cadence_minutes),
        updated_at = now()
      where id = p_space_id;
    else
      update public.activity_spaces set
        heartbeat_enabled = false, heartbeat_next_at = null, updated_at = now()
      where id = p_space_id;
    end if;
    return p_enabled;
  end
  $body$
  $f$;
  execute 'revoke all on function public.set_space_heartbeat(uuid, boolean, integer, numeric, time, time, text, numeric) from public';
  execute 'grant execute on function public.set_space_heartbeat(uuid, boolean, integer, numeric, time, time, text, numeric) to authenticated';
end
$$;
