-- An automation's workflow as drawn on its canvas: the steps and decisions,
-- where they sit, and the arrows between them. The text the run reads
-- (automations.workflow) is written from this drawing by the app on every
-- edit; an automation with no drawing yet shows its text as a line of steps.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.automations') is null then
    return;
  end if;
  alter table public.automations add column if not exists workflow_graph jsonb;
  alter table public.automations drop constraint if exists automations_workflow_graph_size;
  alter table public.automations add constraint automations_workflow_graph_size
    check (workflow_graph is null or pg_column_size(workflow_graph) <= 200000);
end $$;
