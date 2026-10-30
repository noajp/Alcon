-- An Element always has exactly one home: an Object (object_id) or a person
-- (owner_id, a personal Element in My Elements). Never both, never neither.
--
-- Neither was a global bucket: with no Object, no owner and no junction row,
-- every RLS predicate admitted every caller, so anyone in any Space could
-- read, edit, delete and decide the approval of such an Element.
-- Both let a working member tag an Object Element with owner_id = themselves
-- and keep reading, writing and deleting it after they were removed from the
-- Object or made a viewer, because every predicate grants on owner_id alone.
--
-- The trigger settles the home before RLS checks the row:
--   * an Element in an Object drops owner_id;
--   * an Element taken out of its Object moves to another Object it is also
--     filed in, or else becomes the personal Element of whoever moved it;
--   * a new Element with no Object is the creator's personal Element.
-- A write with no signed-in person and no home is refused.
-- Approval management no longer falls through to "anyone" for a homeless
-- Element, since there are none.
do $m$
begin
  if to_regclass('public.elements') is null or to_regclass('public.element_objects') is null then
    raise notice 'elements one home skipped: tables not present'; return;
  end if;

  execute 'create schema if not exists alcon_internal';

  execute $f$
    create or replace function alcon_internal.elements_settle_home()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    begin
      if new.object_id is not null then
        new.owner_id := null;
        return new;
      end if;
      if new.owner_id is not null then
        return new;
      end if;
      if tg_op = 'UPDATE' and old.object_id is not null then
        select eo.object_id into new.object_id
          from public.element_objects eo
         where eo.element_id = new.id and eo.object_id <> old.object_id
         order by eo.is_primary desc, eo.object_id
         limit 1;
        if new.object_id is not null then
          return new;
        end if;
      end if;
      if auth.uid() is null then
        raise exception 'An Element needs an Object or an owner' using errcode = '23514';
      end if;
      new.owner_id := auth.uid();
      return new;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.elements_settle_home() from public, anon, authenticated';

  -- Named to sort before elements_guard_approval, so the approval guard and
  -- RLS both see the settled home.
  execute 'drop trigger if exists elements_aa_settle_home on public.elements';
  execute 'create trigger elements_aa_settle_home before insert or update of object_id, owner_id on public.elements
    for each row execute function alcon_internal.elements_settle_home()';

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.elements'::regclass and conname = 'elements_one_home') then
    execute 'alter table public.elements add constraint elements_one_home
      check ((object_id is null) <> (owner_id is null)) not valid';
    execute 'alter table public.elements validate constraint elements_one_home';
  end if;

  if to_regprocedure('public.user_can_see_element(uuid)') is not null
     and to_regprocedure('public.user_has_domain_role(uuid, text[])') is not null
     and to_regclass('public.object_domains') is not null then
    execute $f$
      create or replace function public.user_can_manage_approval(p_element uuid) returns boolean
      language sql stable security definer set search_path = public as $fn$
        with home as (
          select e.object_id from public.elements e where e.id = p_element and e.object_id is not null
        ),
        domains as (
          select o.domain_id from home h join public.objects o on o.id = h.object_id where o.domain_id is not null
          union
          select od.domain_id from home h join public.object_domains od on od.object_id = h.object_id
        )
        select auth.uid() is not null and public.user_can_see_element(p_element) and case
          when exists (select 1 from domains)
            then exists (select 1 from domains d where public.user_has_domain_role(d.domain_id, array['owner', 'admin']))
          when exists (select 1 from home)
            then exists (select 1 from home h join public.objects o on o.id = h.object_id where o.user_id = auth.uid())
          when exists (select 1 from public.elements e where e.id = p_element and e.owner_id is not null)
            then exists (select 1 from public.elements e where e.id = p_element and e.owner_id = auth.uid())
          else false
        end;
      $fn$
    $f$;
    execute 'revoke all on function public.user_can_manage_approval(uuid) from public, anon';
    execute 'grant execute on function public.user_can_manage_approval(uuid) to authenticated';
  end if;
end $m$;
