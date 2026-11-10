-- An automation carries its own workflow: the steps its run follows,
-- written on the automation itself in the harness's Procedure form
-- ("# 進め方" and one line per step). It is picked from an existing
-- workflow or written new, so an automation no longer needs a harness;
-- one made with a harness keeps running under it.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.automations') is null then
    return;
  end if;
  alter table public.automations
    add column if not exists workflow text not null default '';
  alter table public.automations drop constraint if exists automations_workflow_len;
  alter table public.automations add constraint automations_workflow_len check (char_length(workflow) <= 20000);
  alter table public.automations alter column definition_id drop not null;
end $$;
