-- A run of the agent engine can be a conversation on a Strategy: the person
-- and the agent settle its purpose, success conditions, premises, decisions
-- and definition together, and the run waits for the person between turns.
-- Such a run has a strategy_id and no element_id. Anyone who can see the
-- Strategy can read the conversation; only the person who started it can
-- drive it (run-agent checks triggered_by, and so does the update policy).
do $$
begin
  if to_regclass('public.agent_runs') is null or to_regclass('public.strategies') is null then
    raise notice 'strategy conversations skipped: agent_runs or strategies not present'; return;
  end if;

  execute 'alter table public.agent_runs add column if not exists strategy_id uuid references public.strategies(id) on delete cascade';
  execute 'alter table public.agent_runs alter column element_id drop not null';
  execute 'alter table public.agent_runs drop constraint if exists agent_runs_subject_check';
  execute 'alter table public.agent_runs add constraint agent_runs_subject_check check (element_id is not null or strategy_id is not null)';
  execute 'create index if not exists agent_runs_strategy_idx on public.agent_runs (strategy_id, triggered_by, created_at desc) where strategy_id is not null';

  execute 'drop policy if exists agent_runs_select on public.agent_runs';
  execute $p$create policy agent_runs_select on public.agent_runs for select using (
    case when element_id is not null then user_can_read_element(element_id)
         else exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id) end
  )$p$;

  execute 'drop policy if exists agent_runs_insert on public.agent_runs';
  execute $p$create policy agent_runs_insert on public.agent_runs for insert with check (
    triggered_by = (select auth.uid()) and (
      (element_id is not null and user_can_see_element(element_id)
        and (worker_id is null or worker_assignable(worker_id, element_id)))
      or (element_id is null and strategy_id is not null and worker_id is null
        and exists (select 1 from public.strategies s where s.id = agent_runs.strategy_id))
    )
  )$p$;

  execute 'drop policy if exists agent_runs_update on public.agent_runs';
  execute $p$create policy agent_runs_update on public.agent_runs for update using (
    case when element_id is not null then user_can_see_element(element_id)
         else triggered_by = (select auth.uid()) end
  ) with check (
    case when element_id is not null then user_can_see_element(element_id)
         else triggered_by = (select auth.uid()) end
  )$p$;

  -- The app names the Strategy when it starts a conversation and reads it
  -- back. The transcript stays unreadable from the app, as for every run:
  -- the conversation is shown from the run's steps.
  execute 'grant insert (strategy_id), select (strategy_id) on public.agent_runs to authenticated';

  -- A conversation's Space is its Strategy's.
  execute $f$create or replace function public.agent_runs_stamp_space()
    returns trigger language plpgsql security definer set search_path to 'public' as $body$
  begin
    if new.activity_space_id is null then
      new.activity_space_id := case
        when new.element_id is not null then public.element_space(new.element_id)
        else (select s.activity_space_id from public.strategies s where s.id = new.strategy_id)
      end;
    end if;
    return new;
  end
  $body$
  $f$;

  if to_regclass('public.agent_run_steps') is not null then
    execute 'drop policy if exists agent_run_steps_select on public.agent_run_steps';
    execute $p$create policy agent_run_steps_select on public.agent_run_steps for select using (
      exists (select 1 from public.agent_runs r where r.id = agent_run_steps.run_id)
    )$p$;
  end if;
end $$;
