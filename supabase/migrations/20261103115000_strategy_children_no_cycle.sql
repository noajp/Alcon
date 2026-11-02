-- Initiatives nest through strategy_children edges, and only the picker in
-- the UI kept those edges acyclic. Guard it in the database, as Portfolios'
-- parent_id already is: an edge is refused when it points an Initiative at
-- itself or when the child already reaches the parent. SECURITY DEFINER so
-- the walk sees edges the writer cannot read; the advisory lock serialises
-- concurrent inserts that would close a cycle between them.
do $$
begin
  if to_regclass('public.strategy_children') is null then
    raise notice 'strategy_children cycle guard skipped: strategy_children not present'; return;
  end if;

  execute $f$
    create or replace function public.guard_strategy_children_cycle()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, pg_temp
    as $body$
    begin
      if new.parent_strategy_id = new.child_strategy_id then
        raise exception 'an Initiative cannot contain itself' using errcode = '23514';
      end if;
      perform pg_advisory_xact_lock(hashtext('strategy-nesting'));
      if exists (
        with recursive below(id) as (
          select sc.child_strategy_id from public.strategy_children sc
          where sc.parent_strategy_id = new.child_strategy_id
          union
          select sc.child_strategy_id from public.strategy_children sc
          join below b on sc.parent_strategy_id = b.id
        )
        select 1 from below where id = new.parent_strategy_id
      ) then
        raise exception 'nesting this Initiative here would make a cycle' using errcode = '23514';
      end if;
      return new;
    end;
    $body$
  $f$;

  execute 'revoke execute on function public.guard_strategy_children_cycle() from public, anon, authenticated';
  execute 'drop trigger if exists strategy_children_no_cycle on public.strategy_children';
  execute 'create trigger strategy_children_no_cycle
    before insert or update of parent_strategy_id, child_strategy_id on public.strategy_children
    for each row execute function public.guard_strategy_children_cycle()';
end $$;
