-- Properties follow the boundary (ELE_AI-100). A Property value is part of
-- the Element or Object it sits on, so it is visible to exactly the people who
-- can see that Element / Object. A definition is visible inside its own scope.
-- Until now any signed-in user could read and write every value, and every
-- non-personal definition and placement, across Spaces — including deleting
-- another Space's column, which cascades to its values.
--
-- custom_columns            a definition has exactly one scope, fixed once
--                           made (a trigger refuses moving it from a browser):
--   object_id               visible to and changed by whoever sees the Object
--   domain_id               changed by whoever sees the Domain; also readable
--                           by anyone who sees an Object filed under it (an
--                           Object-only invitee reading its Object's fields)
--   activity_space_id       changed by Space members; also readable by anyone
--                           who sees an Object the column is placed on (a
--                           Domain guest reading a library field's values)
--   owner_user_id           the owner only (unchanged)
-- custom_column_placements  an Object's list: whoever sees the Object, and a
--                           column goes only where it belongs — a local column
--                           on its own Object, a Space library column on an
--                           Object of that Space (or, for an Object filed in
--                           no Domain, by a member of the column's Space).
--                           My Elements: the owner, with their own personal
--                           column or a library column of their Space.
-- custom_column_values      read / delete when the Element (element_id) or
--                           Object (object_id) is visible and so is the
--                           column; insert / update also require the column to
--                           belong to that target — an Element value takes a
--                           local column of one of its homes, a library column
--                           placed on one of its homes or on the caller's My
--                           Elements, or the caller's personal column; an
--                           Object value takes a column of a Domain the Object
--                           is filed under. The WITH CHECK reads the new row,
--                           so a value cannot be moved onto a hidden target.
--                           Reads test membership in the caller's visible sets,
--                           computed once per query, not helpers per row.
-- Person values             a trigger checks every Worker a person value
--                           names (a string, or an array of strings): on an
--                           Element, worker_assignable(worker, element); on an
--                           Object, a Worker the caller may list that belongs
--                           to the Object's Space — or, for an Object in no
--                           Space, whose linked person (if any) can see the
--                           Object. Checked when the value, its column or its
--                           target changes; existing values stay.
-- Service role              RLS does not apply; the triggers skip calls with
--                           no auth.uid().
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.custom_columns') is null
     or to_regclass('public.custom_column_values') is null
     or to_regclass('public.custom_column_placements') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.element_objects') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.object_domains') is null
     or to_regclass('public.object_members') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.activity_space_members') is null
     or to_regclass('public.workers') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.worker_assignable(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.object_in_space(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.object_home_space(uuid)') is null
     or to_regprocedure('alcon_internal.worker_in_space(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.user_can_list_worker(uuid)') is null
     or to_regprocedure('alcon_internal.user_can_see_object_as(uuid, uuid)') is null then
    raise notice 'property_values_follow_visibility skipped: base schema not present';
    return;
  end if;

  execute 'grant usage on schema alcon_internal to authenticated';

  -- ── The caller's visible sets ───────────────────────────────────────────
  -- Set forms of user_can_see_domain / _object / _element (same branches),
  -- so a policy reads "id in (visible set)" — one hashed set per query —
  -- instead of running the helper chain for every row.
  execute $f$
    create or replace function alcon_internal.visible_domain_ids()
    returns setof uuid language sql stable security definer set search_path = public as $b$
      select d.id from public.domains d where d.user_id = auth.uid()
      union
      select dm.domain_id from public.domain_members dm where dm.user_id = auth.uid()
      union
      select d.id from public.domains d
        join public.activity_space_members m on m.activity_space_id = d.activity_space_id
       where d.privacy = 'workspace' and m.user_id = auth.uid();
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.visible_object_ids()
    returns setof uuid language sql stable security definer set search_path = public as $b$
      with vd as (select alcon_internal.visible_domain_ids() as id)
      select om.object_id from public.object_members om where om.user_id = auth.uid()
      union
      select o.id from public.objects o where o.domain_id in (select id from vd)
      union
      select od.object_id from public.object_domains od where od.domain_id in (select id from vd);
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.visible_element_ids()
    returns setof uuid language sql stable security definer set search_path = public as $b$
      with vo as (select alcon_internal.visible_object_ids() as id)
      select e.id from public.elements e
       where e.owner_id = auth.uid()
          or e.object_id in (select id from vo)
          or (e.object_id is null and e.owner_id is null
              and not exists (select 1 from public.element_objects eo where eo.element_id = e.id))
      union
      select eo.element_id from public.element_objects eo where eo.object_id in (select id from vo);
    $b$
  $f$;

  -- ── Definitions ─────────────────────────────────────────────────────────
  -- From the row's own columns, so INSERT … RETURNING reads the row it wrote.
  execute $f$
    create or replace function alcon_internal.custom_column_readable(
      p_column uuid, p_object uuid, p_domain uuid, p_space uuid, p_owner uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and (
        (p_object is not null and public.user_can_see_object(p_object))
        or (p_domain is not null and (
              public.user_can_see_domain(p_domain)
              or exists (select 1 from public.objects o
                          where o.domain_id = p_domain and public.user_can_see_object(o.id))
              or exists (select 1 from public.object_domains od
                          where od.domain_id = p_domain and public.user_can_see_object(od.object_id))))
        or (p_space is not null and (
              public.is_activity_space_member(p_space)
              or exists (select 1 from public.custom_column_placements pl
                          where pl.column_id = p_column and pl.object_id is not null
                            and public.user_can_see_object(pl.object_id))))
        or (p_owner is not null and p_owner = auth.uid()));
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.custom_column_manageable(
      p_object uuid, p_domain uuid, p_space uuid, p_owner uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and (
        (p_object is not null and public.user_can_see_object(p_object))
        or (p_domain is not null and public.user_can_see_domain(p_domain))
        or (p_space is not null and public.is_activity_space_member(p_space))
        or (p_owner is not null and p_owner = auth.uid()));
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.user_can_see_custom_column(p_column uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select coalesce((
        select alcon_internal.custom_column_readable(c.id, c.object_id, c.domain_id, c.activity_space_id, c.owner_user_id)
          from public.custom_columns c where c.id = p_column), false);
    $b$
  $f$;

  -- Set form of custom_column_readable over every column.
  execute $f$
    create or replace function alcon_internal.readable_column_ids()
    returns setof uuid language sql stable security definer set search_path = public as $b$
      with vo as (select alcon_internal.visible_object_ids() as id),
           vd as (select alcon_internal.visible_domain_ids() as id
                  union select o.domain_id from public.objects o
                         where o.domain_id is not null and o.id in (select id from vo)
                  union select od.domain_id from public.object_domains od
                         where od.object_id in (select id from vo))
      select c.id from public.custom_columns c
       where auth.uid() is not null and (
             c.object_id in (select id from vo)
          or c.domain_id in (select id from vd)
          or c.activity_space_id in (select m.activity_space_id from public.activity_space_members m
                                      where m.user_id = auth.uid())
          or c.owner_user_id = auth.uid()
          or (c.activity_space_id is not null and c.id in (
                select pl.column_id from public.custom_column_placements pl
                 where pl.object_id in (select id from vo))));
    $b$
  $f$;

  -- An Element is homed in an Object through its primary object_id or the
  -- element_objects junction.
  execute $f$
    create or replace function alcon_internal.element_homed_in(p_element uuid, p_object uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select p_object is not null and (
        exists (select 1 from public.elements e where e.id = p_element and e.object_id = p_object)
        or exists (select 1 from public.element_objects eo
                    where eo.element_id = p_element and eo.object_id = p_object));
    $b$
  $f$;

  -- Where a column may be placed.
  execute $f$
    create or replace function alcon_internal.custom_column_placeable(
      p_column uuid, p_object uuid, p_owner uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and exists (
        select 1 from public.custom_columns c
        where c.id = p_column and (
          (p_object is not null and public.user_can_see_object(p_object) and (
             c.object_id = p_object
             or (c.activity_space_id is not null and (
                  alcon_internal.object_in_space(p_object, c.activity_space_id)
                  or (alcon_internal.object_home_space(p_object) is null
                      and public.is_activity_space_member(c.activity_space_id))))))
          or (p_object is null and p_owner is not null and p_owner = auth.uid() and (
             c.owner_user_id = auth.uid()
             or (c.activity_space_id is not null and public.is_activity_space_member(c.activity_space_id))))));
    $b$
  $f$;

  -- Which column a value may take on its target.
  execute $f$
    create or replace function alcon_internal.custom_column_fits(
      p_column uuid, p_element uuid, p_object uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and exists (
        select 1 from public.custom_columns c
        where c.id = p_column and (
          (p_element is not null and (
             (c.owner_user_id is not null and c.owner_user_id = auth.uid())
             or (c.object_id is not null and alcon_internal.element_homed_in(p_element, c.object_id))
             or (c.activity_space_id is not null and exists (
                  select 1 from public.custom_column_placements pl
                   where pl.column_id = c.id
                     and ((pl.object_id is not null and alcon_internal.element_homed_in(p_element, pl.object_id))
                          or (pl.owner_user_id is not null and pl.owner_user_id = auth.uid()))))))
          or (p_element is null and p_object is not null and c.domain_id is not null and (
             exists (select 1 from public.objects o where o.id = p_object and o.domain_id = c.domain_id)
             or exists (select 1 from public.object_domains od
                         where od.object_id = p_object and od.domain_id = c.domain_id)))));
    $b$
  $f$;

  execute 'revoke all on function alcon_internal.visible_domain_ids() from public, anon';
  execute 'grant execute on function alcon_internal.visible_domain_ids() to authenticated';
  execute 'revoke all on function alcon_internal.visible_object_ids() from public, anon';
  execute 'grant execute on function alcon_internal.visible_object_ids() to authenticated';
  execute 'revoke all on function alcon_internal.visible_element_ids() from public, anon';
  execute 'grant execute on function alcon_internal.visible_element_ids() to authenticated';
  execute 'revoke all on function alcon_internal.readable_column_ids() from public, anon';
  execute 'grant execute on function alcon_internal.readable_column_ids() to authenticated';
  execute 'revoke all on function alcon_internal.custom_column_readable(uuid, uuid, uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.custom_column_readable(uuid, uuid, uuid, uuid, uuid) to authenticated';
  execute 'revoke all on function alcon_internal.custom_column_manageable(uuid, uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.custom_column_manageable(uuid, uuid, uuid, uuid) to authenticated';
  execute 'revoke all on function alcon_internal.user_can_see_custom_column(uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_can_see_custom_column(uuid) to authenticated';
  execute 'revoke all on function alcon_internal.element_homed_in(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.custom_column_placeable(uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.custom_column_placeable(uuid, uuid, uuid) to authenticated';
  execute 'revoke all on function alcon_internal.custom_column_fits(uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.custom_column_fits(uuid, uuid, uuid) to authenticated';

  -- ── custom_columns ──────────────────────────────────────────────────────
  execute 'drop policy if exists "Authenticated full access" on public.custom_columns';
  execute 'drop policy if exists "Property columns access" on public.custom_columns';
  execute 'drop policy if exists custom_columns_select on public.custom_columns';
  execute 'drop policy if exists custom_columns_insert on public.custom_columns';
  execute 'drop policy if exists custom_columns_update on public.custom_columns';
  execute 'drop policy if exists custom_columns_delete on public.custom_columns';
  execute $p$create policy custom_columns_select on public.custom_columns
    for select to authenticated
    using (alcon_internal.custom_column_readable(id, object_id, domain_id, activity_space_id, owner_user_id))$p$;
  execute $p$create policy custom_columns_insert on public.custom_columns
    for insert to authenticated
    with check (alcon_internal.custom_column_manageable(object_id, domain_id, activity_space_id, owner_user_id))$p$;
  execute $p$create policy custom_columns_update on public.custom_columns
    for update to authenticated
    using (alcon_internal.custom_column_manageable(object_id, domain_id, activity_space_id, owner_user_id))
    with check (alcon_internal.custom_column_manageable(object_id, domain_id, activity_space_id, owner_user_id))$p$;
  execute $p$create policy custom_columns_delete on public.custom_columns
    for delete to authenticated
    using (alcon_internal.custom_column_manageable(object_id, domain_id, activity_space_id, owner_user_id))$p$;

  -- A column's scope is fixed once made: moving it would carry its values and
  -- placements into another scope. No app flow moves a column.
  execute $f$
    create or replace function alcon_internal.custom_columns_guard_scope()
    returns trigger language plpgsql set search_path = public as $g$
    begin
      if auth.uid() is null then return new; end if;  -- service role
      if new.object_id is distinct from old.object_id
         or new.domain_id is distinct from old.domain_id
         or new.activity_space_id is distinct from old.activity_space_id
         or new.owner_user_id is distinct from old.owner_user_id then
        raise exception 'a Property''s scope cannot be changed' using errcode = '42501';
      end if;
      return new;
    end
    $g$
  $f$;
  execute 'revoke all on function alcon_internal.custom_columns_guard_scope() from public, anon, authenticated';
  execute 'drop trigger if exists trg_custom_columns_guard_scope on public.custom_columns';
  execute 'create trigger trg_custom_columns_guard_scope
    before update of object_id, domain_id, activity_space_id, owner_user_id on public.custom_columns
    for each row execute function alcon_internal.custom_columns_guard_scope()';

  -- ── custom_column_placements ────────────────────────────────────────────
  execute 'drop policy if exists "Property placements access" on public.custom_column_placements';
  execute 'drop policy if exists custom_column_placements_select on public.custom_column_placements';
  execute 'drop policy if exists custom_column_placements_insert on public.custom_column_placements';
  execute 'drop policy if exists custom_column_placements_update on public.custom_column_placements';
  execute 'drop policy if exists custom_column_placements_delete on public.custom_column_placements';
  execute $p$create policy custom_column_placements_select on public.custom_column_placements
    for select to authenticated
    using ((owner_user_id is not null and owner_user_id = auth.uid())
           or (object_id is not null and public.user_can_see_object(object_id)))$p$;
  execute $p$create policy custom_column_placements_insert on public.custom_column_placements
    for insert to authenticated
    with check (alcon_internal.custom_column_placeable(column_id, object_id, owner_user_id))$p$;
  execute $p$create policy custom_column_placements_update on public.custom_column_placements
    for update to authenticated
    using ((owner_user_id is not null and owner_user_id = auth.uid())
           or (object_id is not null and public.user_can_see_object(object_id)))
    with check (alcon_internal.custom_column_placeable(column_id, object_id, owner_user_id))$p$;
  execute $p$create policy custom_column_placements_delete on public.custom_column_placements
    for delete to authenticated
    using ((owner_user_id is not null and owner_user_id = auth.uid())
           or (object_id is not null and public.user_can_see_object(object_id)))$p$;

  -- ── custom_column_values ────────────────────────────────────────────────
  -- USING reads the visible sets (a list fetch reads many rows); WITH CHECK
  -- tests the one row being written with the scalar helpers.
  execute 'drop policy if exists "Authenticated full access" on public.custom_column_values';
  execute 'drop policy if exists custom_column_values_select on public.custom_column_values';
  execute 'drop policy if exists custom_column_values_insert on public.custom_column_values';
  execute 'drop policy if exists custom_column_values_update on public.custom_column_values';
  execute 'drop policy if exists custom_column_values_delete on public.custom_column_values';
  execute $p$create policy custom_column_values_select on public.custom_column_values
    for select to authenticated
    using (column_id in (select alcon_internal.readable_column_ids())
           and ((element_id is not null and element_id in (select alcon_internal.visible_element_ids()))
                or (element_id is null and object_id in (select alcon_internal.visible_object_ids()))))$p$;
  execute $p$create policy custom_column_values_insert on public.custom_column_values
    for insert to authenticated
    with check (((element_id is not null and public.user_can_see_element(element_id))
                 or (element_id is null and object_id is not null and public.user_can_see_object(object_id)))
                and alcon_internal.user_can_see_custom_column(column_id)
                and alcon_internal.custom_column_fits(column_id, element_id, object_id))$p$;
  execute $p$create policy custom_column_values_update on public.custom_column_values
    for update to authenticated
    using (column_id in (select alcon_internal.readable_column_ids())
           and ((element_id is not null and element_id in (select alcon_internal.visible_element_ids()))
                or (element_id is null and object_id in (select alcon_internal.visible_object_ids()))))
    with check (((element_id is not null and public.user_can_see_element(element_id))
                 or (element_id is null and object_id is not null and public.user_can_see_object(object_id)))
                and alcon_internal.user_can_see_custom_column(column_id)
                and alcon_internal.custom_column_fits(column_id, element_id, object_id))$p$;
  execute $p$create policy custom_column_values_delete on public.custom_column_values
    for delete to authenticated
    using (column_id in (select alcon_internal.readable_column_ids())
           and ((element_id is not null and element_id in (select alcon_internal.visible_element_ids()))
                or (element_id is null and object_id in (select alcon_internal.visible_object_ids()))))$p$;

  -- ── Person values name Workers inside the boundary ──────────────────────
  -- A Person value is a plain column anyone with the row can set; the workers
  -- SELECT policy shows its name only when the Worker is in the Element's
  -- Space, and this keeps new values to Workers the caller could pick there.
  execute $f$
    create or replace function alcon_internal.custom_column_values_check_person()
    returns trigger language plpgsql security definer set search_path = public as $g$
    declare
      v_type text;
      v_ids text[];
      v_id text;
      v_worker uuid;
      v_space uuid;
      v_person uuid;
      v_ok boolean;
    begin
      if auth.uid() is null then return new; end if;  -- service role
      if tg_op = 'UPDATE'
         and new.value is not distinct from old.value
         and new.column_id is not distinct from old.column_id
         and new.element_id is not distinct from old.element_id
         and new.object_id is not distinct from old.object_id then
        return new;
      end if;
      select c.column_type into v_type from public.custom_columns c where c.id = new.column_id;
      if v_type is distinct from 'person' or new.value is null or jsonb_typeof(new.value) = 'null' then
        return new;
      end if;
      if jsonb_typeof(new.value) = 'string' then
        v_ids := array[new.value #>> '{}'];
      elsif jsonb_typeof(new.value) = 'array'
            and not exists (select 1 from jsonb_array_elements(new.value) x where jsonb_typeof(x) <> 'string') then
        select coalesce(array_agg(x), '{}') into v_ids from jsonb_array_elements_text(new.value) x;
      else
        raise exception 'a Person value is a Worker id or a list of Worker ids' using errcode = '22023';
      end if;
      if new.element_id is null then
        v_space := alcon_internal.object_home_space(new.object_id);
      end if;
      foreach v_id in array v_ids loop
        v_worker := null;
        if v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
          v_worker := v_id::uuid;
        end if;
        if v_worker is null then
          v_ok := false;
        elsif new.element_id is not null then
          v_ok := public.worker_assignable(v_worker, new.element_id);
        elsif v_space is not null then
          v_ok := alcon_internal.user_can_list_worker(v_worker)
                  and alcon_internal.worker_in_space(v_worker, v_space);
        else
          -- An Object in no Space: a Worker the caller may list, whose
          -- person (if linked) can see the Object.
          select w.user_id into v_person from public.workers w where w.id = v_worker;
          v_ok := alcon_internal.user_can_list_worker(v_worker)
                  and (v_person is null or alcon_internal.user_can_see_object_as(new.object_id, v_person));
        end if;
        if not coalesce(v_ok, false) then
          raise exception 'this Worker cannot be set here: they are outside its Space or cannot see it'
            using errcode = '42501', hint = 'alcon:person_outside_boundary';
        end if;
      end loop;
      return new;
    end
    $g$
  $f$;
  execute 'revoke all on function alcon_internal.custom_column_values_check_person() from public, anon, authenticated';
  execute 'drop trigger if exists trg_custom_column_values_check_person on public.custom_column_values';
  execute 'create trigger trg_custom_column_values_check_person
    before insert or update on public.custom_column_values
    for each row execute function alcon_internal.custom_column_values_check_person()';
end
$$;
