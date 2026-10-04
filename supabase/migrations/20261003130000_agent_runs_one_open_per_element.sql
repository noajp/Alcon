-- One open run per Element (ADR 0027). The client returns the open run
-- instead of starting another, but two starts at the same moment (the board
-- and the detail page, or two people) could both insert; this index makes
-- the second insert fail, and the client then returns the run that won.
-- Guarded for preview replay.
do $$
begin
  if to_regclass('public.agent_runs') is null then
    raise notice 'agent_runs_one_open_per_element skipped: agent_runs not present';
    return;
  end if;
  create unique index if not exists agent_runs_one_open_per_element
    on public.agent_runs (element_id)
    where status in ('queued', 'running', 'awaiting_approval', 'paused');
end
$$;
