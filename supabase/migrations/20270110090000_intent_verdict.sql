-- A hypothesis is found out: unverified until someone says it holds or does
-- not. The verdict is its own column — `status` says how the work on a row is
-- going, which is a different question, and a rejected hypothesis is the
-- strongest reason the work resting on it has to be looked at again. Null
-- reads as unverified; only a hypothesis carries one.
do $$
begin
  if to_regclass('public.intents') is null then
    raise notice 'intent verdict skipped: intents not present'; return;
  end if;
  execute 'alter table public.intents add column if not exists verdict text';
  execute 'alter table public.intents drop constraint if exists intents_verdict_check';
  execute $q$alter table public.intents add constraint intents_verdict_check
    check (verdict is null or (kind = 'assumption' and verdict in ('supported', 'rejected')))$q$;
end $$;
