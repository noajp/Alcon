-- agent_runs is readable from the browser column by column: the transcript
-- and the one-time continuation token stay with the service role, and every
-- other column is granted to signed-in users. The run's records added after
-- that list was written (the verdict and proposed readings, the finish and
-- failure details, the chain scope) are read by the run panel, the plan
-- popup and the Audit log, so they are granted here. RLS still decides
-- which rows a person sees.
do $$
declare
  col text;
begin
  if to_regclass('public.agent_runs') is null then
    raise notice 'agent_runs record grants skipped: agent_runs not present';
    return;
  end if;
  foreach col in array array['verdict', 'proposed_readings', 'finish_detail', 'failure_detail', 'chain_scope'] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'agent_runs' and column_name = col
    ) then
      execute format('grant select (%I) on public.agent_runs to authenticated', col);
    end if;
  end loop;
end
$$;
