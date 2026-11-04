-- Strategies keep the order a person drags them into, and take reactions
-- the way an Element does.
--
-- strategies.order_index: the sibling order in the Strategy list. Null sorts
-- after the ordered ones, oldest first, so Strategies nobody has moved keep
-- the order they had.
--
-- element_reactions.strategy_id: a reaction on a Strategy. A row reacts to
-- exactly one of an Element, a comment, or a Strategy; reading and adding one
-- follows who can read the Strategy.

do $$
begin
  if to_regclass('public.strategies') is null then
    raise notice 'strategies.order_index skipped: strategies not present'; return;
  end if;
  execute 'alter table public.strategies add column if not exists order_index double precision';
end $$;

do $$
begin
  if to_regclass('public.element_reactions') is null or to_regclass('public.strategies') is null then
    raise notice 'strategy reactions skipped: element_reactions or strategies not present'; return;
  end if;
  execute 'alter table public.element_reactions add column if not exists strategy_id uuid references public.strategies(id) on delete cascade';
  execute 'create index if not exists element_reactions_strategy_id_idx on public.element_reactions(strategy_id)';
  execute 'alter table public.element_reactions drop constraint if exists element_reactions_check';
  execute 'alter table public.element_reactions add constraint element_reactions_check check (((element_id is not null)::int + (comment_id is not null)::int + (strategy_id is not null)::int) = 1)';

  execute 'drop policy if exists element_reactions_select on public.element_reactions';
  execute $p$create policy element_reactions_select on public.element_reactions for select to authenticated using (
    case
      when element_id is not null then user_can_read_element(element_id)
      when strategy_id is not null then user_can_read_strategy(strategy_id)
      else exists (select 1 from element_comments c where c.id = element_reactions.comment_id)
    end)$p$;

  execute 'drop policy if exists element_reactions_insert on public.element_reactions';
  execute $p$create policy element_reactions_insert on public.element_reactions for insert to authenticated with check (
    user_id = (select auth.uid()) and
    case
      when element_id is not null then user_can_see_element(element_id)
      when strategy_id is not null then user_can_read_strategy(strategy_id)
      else exists (select 1 from element_comments c where c.id = element_reactions.comment_id and user_can_see_element(c.element_id))
    end)$p$;
end $$;
