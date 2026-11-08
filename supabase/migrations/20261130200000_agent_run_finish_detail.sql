-- A run's finish, typed and sealed: the claims the standing finish made
-- ({text, source, retrievedAt, type}) and the points it could not confirm.
-- Written once, with the verdict, at a terminal finish by run-agent
-- (finishClaims.ts); never updated afterwards. The verdict record keeps the
-- claim accounting (counts and mechanical findings); this column keeps the
-- finish itself, so the audit drill-down can show the claims a person is
-- judging and the run list can filter to finishes that named unconfirmed
-- points. Idempotent: the whole statement is skipped when the base table
-- predates this repo (same posture as the verdict column migration).
do $$
begin
  if to_regclass('public.agent_runs') is not null then
    alter table public.agent_runs add column if not exists finish_detail jsonb;
    comment on column public.agent_runs.finish_detail is $c$The finish as submitted, typed: {claims: [{text, source, retrievedAt, type}], unconfirmed: [..]}. Sealed at a terminal finish with the verdict and never updated. Written by run-agent (finishClaims.ts); null on runs that finished before this column existed or on non-terminal finishes.$c$;
  end if;
end $$;
