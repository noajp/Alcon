-- An Element remembers the Initiative it was cut from, and the dev loop
-- reads its Domain from the database.
--
--   elements.strategy_id   the Initiative this Element was proposed for.
--                          A proposal is status 'backlog' with the label
--                          'proposal'; approving it removes the label and
--                          moves it to 'todo'. The link stays after that, so
--                          an Initiative finds the work done for it in any
--                          Object, without tying whole Objects to it.
--   dev_control.domain_id  the Domain the dev loop works in. The ops scripts
--                          read it here instead of carrying an id of their own.
do $$
begin
  if to_regclass('public.elements') is not null and to_regclass('public.strategies') is not null then
    execute 'alter table public.elements add column if not exists strategy_id uuid references public.strategies(id) on delete set null';
    execute 'create index if not exists elements_strategy_id_idx on public.elements (strategy_id) where strategy_id is not null';
  else
    raise notice 'initiative_delegation: elements or strategies not present';
  end if;

  if to_regclass('public.dev_control') is not null and to_regclass('public.domains') is not null then
    execute 'alter table public.dev_control add column if not exists domain_id uuid references public.domains(id) on delete set null';
  else
    raise notice 'initiative_delegation: dev_control or domains not present';
  end if;
end
$$;
