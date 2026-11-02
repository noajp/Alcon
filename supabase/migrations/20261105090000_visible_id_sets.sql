-- Row visibility for objects and elements asked user_can_read_object →
-- user_can_read_domain → is_activity_space_member (SECURITY DEFINER, nested)
-- once per row, so a read grew with the rows it scanned (ELE_DB-006). The
-- sets of Domains and Objects the caller can read are now computed once per
-- statement — `id = any (select …)` is an initplan — by two functions in
-- alcon_internal (not exposed through the API). They restate
-- user_can_read_domain / user_can_read_object, which stay for the other
-- policies and RPCs.
--
-- The SELECT policies of objects and elements move to these sets, for
-- signed-in users only: neither table was ever meant to be read signed out.
do $mig$
begin
  if to_regclass('public.objects') is null or to_regclass('public.elements') is null
     or to_regclass('public.domains') is null or to_regclass('public.domain_members') is null
     or to_regclass('public.object_members') is null or to_regclass('public.object_domains') is null
     or to_regclass('public.element_objects') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'visible_id_sets skipped: base schema not present'; return;
  end if;

  execute $f$
    create or replace function alcon_internal.my_readable_domain_ids()
    returns setof uuid language sql stable security definer set search_path = public as $b$
      select d.id from public.domains d
      where exists (select 1 from public.domain_members m where m.domain_id = d.id and m.user_id = auth.uid())
         or (d.privacy = 'workspace' and d.activity_space_id is not null
             and public.is_activity_space_member(d.activity_space_id))
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.my_readable_object_ids()
    returns setof uuid language sql stable security definer set search_path = public as $b$
      with domains as (select alcon_internal.my_readable_domain_ids() as id)
      select om.object_id from public.object_members om where om.user_id = auth.uid()
      union
      select o.id from public.objects o where o.domain_id in (select id from domains)
      union
      select od.object_id from public.object_domains od where od.domain_id in (select id from domains)
    $b$
  $f$;

  execute 'revoke all on function alcon_internal.my_readable_domain_ids() from public, anon';
  execute 'revoke all on function alcon_internal.my_readable_object_ids() from public, anon';
  execute 'grant execute on function alcon_internal.my_readable_domain_ids() to authenticated, service_role';
  execute 'grant execute on function alcon_internal.my_readable_object_ids() to authenticated, service_role';

  execute 'drop policy if exists "objects select visible" on public.objects';
  -- The row's own domain_id is checked first: insert ... returning reads the
  -- new row back before my_readable_object_ids can see it.
  execute 'create policy "objects select visible" on public.objects for select to authenticated
    using ((domain_id is not null and domain_id = any (array(select alcon_internal.my_readable_domain_ids())))
           or id = any (array(select alcon_internal.my_readable_object_ids())))';

  execute 'drop policy if exists "elements select visible" on public.elements';
  execute $p$create policy "elements select visible" on public.elements for select to authenticated
    using (
      owner_id = (select auth.uid())
      or (object_id is not null and object_id = any (array(select alcon_internal.my_readable_object_ids())))
      or exists (select 1 from public.element_objects eo
                  where eo.element_id = elements.id
                    and eo.object_id = any (array(select alcon_internal.my_readable_object_ids())))
      or (object_id is null and owner_id is null
          and not exists (select 1 from public.element_objects eo where eo.element_id = elements.id))
    )$p$;
end $mig$;
