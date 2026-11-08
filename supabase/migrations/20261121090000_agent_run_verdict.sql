-- A run's verdict: the verifier's judgement of the finish that stood, kept
-- as data instead of a line of step text. Written once by run-agent at a
-- terminal finish and never updated. proposed_readings holds the measure
-- readings the finish proposed and whether each one landed (Part 2).
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.agent_runs') is not null then
    execute 'alter table public.agent_runs add column if not exists verdict jsonb';
    execute $c$comment on column public.agent_runs.verdict is 'The verifier''s record for the finish that stood: { v, result: pass|fail|unchecked, source: verifier|none, model, gaps, revisions, checkedAt, outcome, reason, evidence }. Null before Phase 2 and for converse runs.'$c$;
    execute 'alter table public.agent_runs add column if not exists proposed_readings jsonb';
    execute 'comment on column public.agent_runs.proposed_readings is ''Readings the finish proposed: [{ measureId, value, applied, appliedAt, appliedBy, heldReason }]. Written at finish; only the applied fields change afterwards.''';
  end if;
end $$;
