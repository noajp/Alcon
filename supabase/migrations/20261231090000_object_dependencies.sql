-- Object dependencies: "this Object waits for that one". A row says the
-- blocked Object should start after the blocker is done; the Gantt draws the
-- link and flags it when the dates disagree. Reading a link needs both ends
-- readable; adding or removing one needs to be able to work in both.
do $$
begin
  if to_regclass('public.objects') is null then
    raise notice 'object_dependencies skipped: objects not present'; return;
  end if;

  create table if not exists public.object_dependencies (
    id uuid primary key default gen_random_uuid(),
    blocker_object_id uuid not null references public.objects(id) on delete cascade,
    blocked_object_id uuid not null references public.objects(id) on delete cascade,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    constraint object_dependencies_pair unique (blocker_object_id, blocked_object_id),
    constraint object_dependencies_not_self check (blocker_object_id <> blocked_object_id)
  );
  create index if not exists object_dependencies_blocked_idx on public.object_dependencies (blocked_object_id);

  alter table public.object_dependencies enable row level security;
  drop policy if exists object_dependencies_select on public.object_dependencies;
  drop policy if exists object_dependencies_insert on public.object_dependencies;
  drop policy if exists object_dependencies_delete on public.object_dependencies;
  create policy object_dependencies_select on public.object_dependencies for select to authenticated
    using (public.user_can_read_object(blocker_object_id) and public.user_can_read_object(blocked_object_id));
  create policy object_dependencies_insert on public.object_dependencies for insert to authenticated
    with check (public.user_can_see_object(blocker_object_id) and public.user_can_see_object(blocked_object_id));
  create policy object_dependencies_delete on public.object_dependencies for delete to authenticated
    using (public.user_can_see_object(blocker_object_id) and public.user_can_see_object(blocked_object_id));
end $$;
