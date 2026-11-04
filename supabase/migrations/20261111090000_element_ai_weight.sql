-- How heavy an Element's work is for an AI, so a run picks a model by cost:
--
--   light      transcribing, formatting, short summaries      → the small model
--   standard   research and writing (the default when unset)  → the standard model
--   heavy      design, hard judgment, long reasoning          → the large model
--
-- The planner sets it when it decomposes a Strategy; a person can change it.
-- A model named on the Worker or the Domain still wins over it.
-- Read by run-agent (supabase/functions/run-agent/agentConfig.ts).
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.elements') is null then
    raise notice 'element ai_weight skipped: elements not present'; return;
  end if;
  execute 'alter table public.elements add column if not exists ai_weight text';
  if not exists (select 1 from pg_constraint where conname = 'elements_ai_weight_check') then
    execute 'alter table public.elements add constraint elements_ai_weight_check check (ai_weight in (''light'', ''standard'', ''heavy''))';
  end if;
end $$;
