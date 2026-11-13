-- Reactions on a Domain, the fifth thing a reaction can be on: read under
-- the Domain's own visibility, written by whoever can see it, as themselves.
-- Guarded for preview replay: the base schema lives outside this folder.
do $$
begin
  if to_regclass('public.domains') is null
     or to_regclass('public.element_reactions') is null
     or to_regprocedure('public.user_can_read_domain(uuid)') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.user_can_read_object(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.user_can_read_element(uuid)') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_read_strategy(uuid)') is null then
    raise notice 'domain reactions skipped: base schema not present';
    return;
  end if;

  alter table public.element_reactions
    add column if not exists domain_id uuid references public.domains(id) on delete cascade;
  create index if not exists element_reactions_domain_idx on public.element_reactions (domain_id) where domain_id is not null;

  alter table public.element_reactions drop constraint if exists element_reactions_check;
  alter table public.element_reactions add constraint element_reactions_check check (
    (element_id is not null)::integer + (comment_id is not null)::integer
    + (strategy_id is not null)::integer + (object_id is not null)::integer
    + (domain_id is not null)::integer = 1
  );

  drop policy if exists element_reactions_select on public.element_reactions;
  create policy element_reactions_select on public.element_reactions
    for select to authenticated
    using (case
      when element_id is not null then public.user_can_read_element(element_id)
      when strategy_id is not null then public.user_can_read_strategy(strategy_id)
      when object_id is not null then public.user_can_read_object(object_id)
      when domain_id is not null then public.user_can_read_domain(domain_id)
      else exists (select 1 from public.element_comments c where c.id = element_reactions.comment_id)
    end);

  drop policy if exists element_reactions_insert on public.element_reactions;
  create policy element_reactions_insert on public.element_reactions
    for insert to authenticated
    with check (
      user_id = (select auth.uid())
      and case
        when element_id is not null then public.user_can_see_element(element_id)
        when strategy_id is not null then public.user_can_read_strategy(strategy_id)
        when object_id is not null then public.user_can_see_object(object_id)
        when domain_id is not null then public.user_can_see_domain(domain_id)
        else exists (select 1 from public.element_comments c
                     where c.id = element_reactions.comment_id and public.user_can_see_element(c.element_id))
      end
    );
end $$;
