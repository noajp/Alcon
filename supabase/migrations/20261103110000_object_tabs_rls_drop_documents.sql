-- object_tabs: visibility follows the parent Object (was: any signed-in user).
-- documents: unused and empty; dropped.
do $$
begin
  if to_regclass('public.object_tabs') is null then
    raise notice 'object_tabs policies skipped: object_tabs not present'; return;
  end if;
  execute 'drop policy if exists "Authenticated full access" on public.object_tabs';
  execute 'drop policy if exists object_tabs_select on public.object_tabs';
  execute 'drop policy if exists object_tabs_insert on public.object_tabs';
  execute 'drop policy if exists object_tabs_update on public.object_tabs';
  execute 'drop policy if exists object_tabs_delete on public.object_tabs';
  execute 'create policy object_tabs_select on public.object_tabs for select to authenticated
    using (public.user_can_see_object(object_id))';
  execute 'create policy object_tabs_insert on public.object_tabs for insert to authenticated
    with check (public.user_can_see_object(object_id))';
  execute 'create policy object_tabs_update on public.object_tabs for update to authenticated
    using (public.user_can_see_object(object_id)) with check (public.user_can_see_object(object_id))';
  execute 'create policy object_tabs_delete on public.object_tabs for delete to authenticated
    using (public.user_can_see_object(object_id))';
end $$;

drop table if exists public.documents;
