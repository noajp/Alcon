-- dev_events and dev_control belong to the self-build loop, not to any
-- tenant. Their only writers are the token-gated dev-event function and the
-- ops scripts, and their only readers are those scripts, all of which use the
-- service role.
--
-- The policies allowed every signed-in account in every Space to read and
-- write both tables through PostgREST. Any account could therefore file
-- forged CI events straight into the loop's notification stream (skipping
-- the dev-event token and its source/kind allowlist), pause the loop or change
-- its concurrency, and read every CI/PR event.
--
-- With the policies gone and the table grants revoked, RLS denies anon and
-- authenticated outright; the service role bypasses RLS as before.
do $m$
begin
  if to_regclass('public.dev_events') is not null then
    execute 'drop policy if exists dev_events_rw on public.dev_events';
    execute 'revoke all on table public.dev_events from anon, authenticated';
  else
    raise notice 'dev_events lockdown skipped: table not present';
  end if;

  if to_regclass('public.dev_control') is not null then
    execute 'drop policy if exists dev_control_rw on public.dev_control';
    execute 'revoke all on table public.dev_control from anon, authenticated';
  else
    raise notice 'dev_control lockdown skipped: table not present';
  end if;
end $m$;
