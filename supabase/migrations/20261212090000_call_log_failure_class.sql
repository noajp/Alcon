-- Failure definitions (back-half program B13), first migration: the
-- call log learns what kind of failure each settled call was.
--
--   integration_call_log.failure_class  the class failurePolicy.ts'
--   classifyCallFailure judged for this attempt (read_failed,
--   auth_failed, unavailable, …), null on a call that landed. The
--   column is the material of two later judgements: a run's give-up
--   counter (the run's failed attempts, counted by class) and the
--   settle classification that reads the log newest-first when a
--   finish fails without a verdict to name it. One row per ATTEMPT:
--   B13's retry dispatches again inside the call seam, and each
--   dispatch is a real call the breaker counts too.
--
-- A record column only: where the column does not exist yet the
-- record stage degrades to best effort (it retries the insert
-- without the class), so this migration carries no deploy-order
-- constraint against the functions.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.integration_call_log') is null then
    raise notice 'failure class skipped: integration_call_log not present';
    return;
  end if;

  execute 'alter table public.integration_call_log add column if not exists failure_class text';
end $$;
