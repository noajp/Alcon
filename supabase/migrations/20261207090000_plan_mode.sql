-- B8 plan mode (plan -> apply dry-run). Two additions:
--
-- 1. agent_runs.plan_mode — the run-side flag, beside `rehearsal`: a plan run
--    executes on the rehearsal substrate (reads live, writes recorded with
--    their exact arguments) and its deliverable is the plan itself, sealed as
--    ONE agent_actions approval unit. The browser sets it when starting a run
--    and reads it back to label the run, mirroring the rehearsal grants.
--
-- 2. agent_actions.decision_source learns "plan": the per-call execution
--    records an apply run writes for calls the approved plan covered —
--    decision_source in ('policy', 'track-record', 'plan') — beside the
--    person's own decision (decision_source null) and the B7 sources.
--
-- Guarded like every migration in this lineage: if the tables do not exist
-- (a database older than the base schema), do nothing.
do $$
begin
  if to_regclass('public.agent_runs') is not null then
    alter table public.agent_runs
      add column if not exists plan_mode boolean not null default false;

    grant insert (plan_mode), select (plan_mode) on public.agent_runs to authenticated;
  end if;

  if to_regclass('public.agent_actions') is not null then
    alter table public.agent_actions
      drop constraint if exists agent_actions_decision_source_check;
    alter table public.agent_actions
      add constraint agent_actions_decision_source_check
      check (decision_source is null or decision_source in ('policy', 'track-record', 'plan'));
  end if;
end $$;
