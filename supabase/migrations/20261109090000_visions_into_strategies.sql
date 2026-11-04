-- Strategy is one concept that nests without limit: what used to be a
-- Vision becomes a Strategy at the top, with the same id, its statement as
-- the description, and the Strategies that sat at its top nested under it.
-- The visions table, strategies.vision_id and their triggers go.
do $$
begin
  if to_regclass('public.strategies') is null or to_regclass('public.visions') is null
     or to_regclass('public.strategy_children') is null then
    raise notice 'visions_into_strategies skipped: tables not present'; return;
  end if;

  execute $q$
    insert into public.strategies (id, name, description, created_by, created_at, updated_at, activity_space_id)
    select v.id, v.name, v.statement, v.created_by, v.created_at, v.updated_at, v.activity_space_id
    from public.visions v
    on conflict (id) do nothing
  $q$;

  -- The Strategies at a Vision's top (no parent of their own) nest under it.
  execute $q$
    insert into public.strategy_children (parent_strategy_id, child_strategy_id)
    select s.vision_id, s.id
    from public.strategies s
    where s.vision_id is not null
      and not exists (select 1 from public.strategy_children c where c.child_strategy_id = s.id)
    on conflict do nothing
  $q$;

  drop trigger if exists strategies_guard_vision on public.strategies;
  drop function if exists public.guard_strategy_vision();
  alter table public.strategies drop column if exists vision_id;
  drop table public.visions;
  drop function if exists public.touch_visions_updated_at();

  -- A Strategy keeps the Space it was made in.
  execute $f$
    create or replace function public.strategies_follow_space() returns trigger
    language plpgsql security definer set search_path = public, pg_temp as $body$
    begin
      if tg_op = 'UPDATE' and new.activity_space_id is null then
        new.activity_space_id := old.activity_space_id;
      end if;
      return new;
    end $body$
  $f$;
end $$;
