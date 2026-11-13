-- A dependency between two Objects says which ends it ties: the waiting
-- Object's start or finish to the other's start or finish.
--   fs  finish → start   the waiting one starts once the other is done (the default)
--   ss  start  → start   it starts once the other has started
--   ff  finish → finish  it finishes once the other is done
--   sf  start  → finish  it finishes once the other has started
-- Element dependencies (element_edges, edge_type 'depends_on') carry the same
-- kind in attributes->>'kind'; no column is needed there.
--
-- Guarded for preview replay: object_dependencies is created outside this folder.

do $$
begin
  if to_regclass('public.object_dependencies') is null then
    raise notice 'dependency kinds skipped: object_dependencies not present';
    return;
  end if;

  alter table public.object_dependencies
    add column if not exists kind text not null default 'fs';

  alter table public.object_dependencies drop constraint if exists object_dependencies_kind_check;
  alter table public.object_dependencies
    add constraint object_dependencies_kind_check check (kind in ('fs', 'ss', 'ff', 'sf'));

  -- Changing a dependency's kind is an update, allowed to whoever may add or
  -- remove it.
  drop policy if exists object_dependencies_update on public.object_dependencies;
  create policy object_dependencies_update on public.object_dependencies for update to authenticated
    using (public.user_can_see_object(blocker_object_id) and public.user_can_see_object(blocked_object_id))
    with check (public.user_can_see_object(blocker_object_id) and public.user_can_see_object(blocked_object_id));
end $$;
