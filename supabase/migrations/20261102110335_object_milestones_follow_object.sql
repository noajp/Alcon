-- Object milestones are part of an Object: who may read one follows who can
-- read that Object (Domain viewers included, as elements / element_objects
-- do), and who may add, rename, move or delete one follows who can work in it
-- (user_can_see_object) — instead of "anyone" reading and any signed-in user
-- writing every Object's.
do $$
begin
  if to_regclass('public.object_milestones') is null then
    raise notice 'object_milestones policies skipped: object_milestones not present'; return;
  end if;
  execute 'alter table public.object_milestones enable row level security';
  execute 'drop policy if exists object_milestones_select on public.object_milestones';
  execute 'drop policy if exists object_milestones_insert on public.object_milestones';
  execute 'drop policy if exists object_milestones_update on public.object_milestones';
  execute 'drop policy if exists object_milestones_delete on public.object_milestones';
  execute $p$create policy object_milestones_select on public.object_milestones for select to authenticated
    using (public.user_can_read_object(object_id))$p$;
  execute $p$create policy object_milestones_insert on public.object_milestones for insert to authenticated
    with check (public.user_can_see_object(object_id))$p$;
  execute $p$create policy object_milestones_update on public.object_milestones for update to authenticated
    using (public.user_can_see_object(object_id)) with check (public.user_can_see_object(object_id))$p$;
  execute $p$create policy object_milestones_delete on public.object_milestones for delete to authenticated
    using (public.user_can_see_object(object_id))$p$;
end $$;
