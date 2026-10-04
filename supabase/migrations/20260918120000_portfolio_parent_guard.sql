-- A Portfolio's parent must be another Portfolio of the same Space, and
-- never itself or one of its own descendants. The client keeps a Portfolio
-- out of its subtree when offering targets; this is the rule itself, so two
-- stale screens (or a direct write) cannot tie a loop that hides the
-- Portfolios from the tree. Guarded for preview replay.
create or replace function public.guard_portfolio_parent()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  cur uuid := new.parent_id;
  parent_space uuid;
  hops integer := 0;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'a Portfolio cannot be its own parent' using errcode = '23514';
  end if;
  select activity_space_id into parent_space from public.portfolios where id = new.parent_id;
  if parent_space is distinct from new.activity_space_id then
    raise exception 'a Portfolio nests only inside a Portfolio of the same Space' using errcode = '23514';
  end if;
  while cur is not null loop
    if cur = new.id then
      raise exception 'a Portfolio cannot nest inside its own descendant' using errcode = '23514';
    end if;
    hops := hops + 1;
    if hops > 1000 then
      raise exception 'Portfolio nesting is too deep' using errcode = '23514';
    end if;
    select parent_id into cur from public.portfolios where id = cur;
  end loop;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.portfolios') is null then return; end if;
  drop trigger if exists portfolios_guard_parent on public.portfolios;
  create trigger portfolios_guard_parent
    before insert or update of parent_id, activity_space_id on public.portfolios
    for each row execute function public.guard_portfolio_parent();
end
$$;
