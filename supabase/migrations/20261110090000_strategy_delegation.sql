-- How far a Strategy's AI work goes on its own. 'manual': an AI's finished
-- work waits for a person's review and nothing starts by itself. 'auto': work
-- that passes the verifier is done, and the AI Elements it unblocks start —
-- the chain stops at a person's Element, an approval, or a blocked run.
do $$
begin
  if to_regclass('public.strategies') is null then
    raise notice 'strategy delegation skipped: strategies not present'; return;
  end if;
  execute 'alter table public.strategies add column if not exists delegation text not null default ''manual''';
  if not exists (select 1 from pg_constraint where conname = 'strategies_delegation_check') then
    execute 'alter table public.strategies add constraint strategies_delegation_check check (delegation in (''manual'', ''auto''))';
  end if;
end $$;
