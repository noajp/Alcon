-- A Copilot conversation (ai_sessions) gets an anchor run: a run whose
-- subject is the session itself (mode 'copilot'), the way a Strategy
-- conversation's run is its session (20261115090000). The panel keeps
-- streaming its turns as before; the anchor exists so that an approval the
-- Copilot stops for lives in the same machinery as every other approval —
-- an agent_actions row a person can find in the Inbox and decide later, a
-- decision the run-agent checks and resumes from, and the session's usage
-- on a run row, where the Space's monthly budget counts it.
--
--   agent_runs    + ai_session_id (the third subject, beside an Element
--                   and a Strategy); one open anchor per session
--   agent_actions element_id becomes nullable (a Copilot approval has no
--                   Element); visibility follows the run's subject, with
--                   the Element branch kept on the action's own column so
--                   an Element action's visibility is exactly what it was;
--                   + expires_at and an 'expired' status, for approvals
--                   nobody decides (only Copilot's expire — an Element's
--                   approval waits as long as it takes)
--   notifications + agent_action_id, so an approval with no Element still
--                   reaches the Inbox (the workflow_approval_id pattern)
--
-- The update policy needs no branch: since 20261115090000 every
-- non-Element run is already updatable only by its starter, which is the
-- Copilot rule too (a session is its author's own).
-- Guarded for preview replay: each part checks what it touches first.
do $$
declare
  has_sessions boolean := to_regclass('public.ai_sessions') is not null;
  has_strategies boolean := to_regclass('public.strategies') is not null;
  v_check text;
  v_case text;
  v_using text;
  v_with_check text;
  v_status_constraint text;
begin
  if to_regclass('public.agent_runs') is null or to_regclass('public.agent_actions') is null then
    raise notice 'copilot anchor runs skipped: agent_runs or agent_actions not present';
    return;
  end if;

  -- ── agent_runs: the session as a subject ──────────────────────────────
  if has_sessions then
    execute 'alter table public.agent_runs add column if not exists ai_session_id uuid references public.ai_sessions(id) on delete set null';
    execute 'create index if not exists agent_runs_ai_session_idx on public.agent_runs (ai_session_id, created_at desc) where ai_session_id is not null';
    -- One open anchor per session, as one open run per Element.
    execute 'create unique index if not exists agent_runs_one_open_per_session on public.agent_runs (ai_session_id) where ai_session_id is not null and status in (''queued'', ''running'', ''awaiting_approval'', ''paused'')';
    -- The app names the session when it reads the anchor back. The
    -- transcript stays unreadable from the app, as for every run.
    execute 'grant insert (ai_session_id), select (ai_session_id) on public.agent_runs to authenticated';
  end if;

  -- The subject check, composed of the subjects that exist here.
  v_check := 'element_id is not null'
    || case when has_strategies then ' or strategy_id is not null' else '' end
    || case when has_sessions then ' or ai_session_id is not null' else '' end;
  execute 'alter table public.agent_runs drop constraint if exists agent_runs_subject_check';
  execute 'alter table public.agent_runs add constraint agent_runs_subject_check check (' || v_check || ')';

  -- An anchor's Space is its session's.
  v_case := 'case when new.element_id is not null then public.element_space(new.element_id)'
    || case when has_strategies then ' when new.strategy_id is not null then (select s.activity_space_id from public.strategies s where s.id = new.strategy_id)' else '' end
    || case when has_sessions then ' when new.ai_session_id is not null then (select s.activity_space_id from public.ai_sessions s where s.id = new.ai_session_id)' else '' end
    || ' end';
  execute $f$create or replace function public.agent_runs_stamp_space()
    returns trigger language plpgsql security definer set search_path to 'public' as $body$
  begin
    if new.activity_space_id is null then
      new.activity_space_id := $f$ || v_case || $f$;
    end if;
    return new;
  end
  $body$
  $f$;

  -- Visibility: an Element's run follows the Element, a Strategy
  -- conversation follows the Strategy, an anchor is its starter's alone
  -- (the session itself is nobody else's to read).
  v_using := 'case when element_id is not null then public.user_can_read_element(element_id)'
    || case when has_strategies then ' when strategy_id is not null then exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id)' else '' end
    || case when has_sessions then ' when ai_session_id is not null then triggered_by = (select auth.uid())' else '' end
    || ' else false end';
  execute 'drop policy if exists agent_runs_select on public.agent_runs';
  execute 'create policy agent_runs_select on public.agent_runs for select using (' || v_using || ')';

  v_with_check := 'triggered_by = (select auth.uid()) and ('
    || '(element_id is not null and public.user_can_see_element(element_id)'
    || ' and (worker_id is null or public.worker_assignable(worker_id, element_id)))'
    || case when has_strategies then ' or (element_id is null and strategy_id is not null and worker_id is null and exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id))' else '' end
    || case when has_sessions then ' or (element_id is null' || case when has_strategies then ' and strategy_id is null' else '' end || ' and ai_session_id is not null and worker_id is null and exists (select 1 from public.ai_sessions s where s.id = agent_runs.ai_session_id and s.user_id = (select auth.uid())))' else '' end
    || ')';
  execute 'drop policy if exists agent_runs_insert on public.agent_runs';
  execute 'create policy agent_runs_insert on public.agent_runs for insert with check (' || v_with_check || ')';

  -- ── agent_actions: an approval may have no Element ───────────────────
  execute 'alter table public.agent_actions alter column element_id drop not null';
  execute 'alter table public.agent_actions add column if not exists expires_at timestamptz';
  execute 'create index if not exists agent_actions_expiry_idx on public.agent_actions (expires_at) where status = ''pending''';

  -- 'expired' joins the statuses. The check is dropped by lookup, not by
  -- an assumed name, so an unnamed inline check is replaced too.
  select conname into v_status_constraint
    from pg_constraint
    where conrelid = 'public.agent_actions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%status in%';
  if v_status_constraint is not null then
    execute format('alter table public.agent_actions drop constraint %I', v_status_constraint);
  end if;
  execute 'alter table public.agent_actions drop constraint if exists agent_actions_status_check';
  execute 'alter table public.agent_actions add constraint agent_actions_status_check check (status in (''pending'', ''approved'', ''rejected'', ''executed'', ''failed'', ''expired''))';

  -- Visibility follows the run's subject. An Element's action keeps the
  -- exact rule it has always had — its own element_id through
  -- user_can_see_element — so nothing an Element's approver could see
  -- changes; only a run with no Element is read through the run.
  v_using := '(element_id is not null and public.user_can_see_element(element_id))'
    || ' or exists (select 1 from public.agent_runs r where r.id = agent_actions.run_id and r.element_id is null and ('
    || case when has_strategies then '(r.strategy_id is not null and exists (select 1 from public.strategies s where s.id = r.strategy_id))' else 'false' end
    || case when has_sessions then ' or (r.ai_session_id is not null and r.triggered_by = (select auth.uid()))' else '' end
    || '))';
  execute 'drop policy if exists agent_actions_select on public.agent_actions';
  execute 'create policy agent_actions_select on public.agent_actions for select to authenticated using (' || v_using || ')';

  -- ── notifications: an approval with no Element reaches the Inbox ─────
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications add column if not exists agent_action_id uuid references public.agent_actions(id) on delete cascade';
  end if;
end
$$;
