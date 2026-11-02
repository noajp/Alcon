-- Units: who belongs where in the organisation — a division, a department,
-- a team, a CoE — nested, each with a lead and its members. Units say who
-- someone is accountable to; Domains say where they work. The two differ: a
-- CoE member is dispatched into Domains their unit does not own, and a
-- Domain draws people from many units.
--
-- A Worker (a person or an AI agent) may belong to several units — a matrix,
-- a secondment. A unit with sub-units cannot be deleted (they would go with
-- it); deleting a unit ends its memberships. A unit cannot sit under itself
-- or its own descendants, nor under a unit of another Space.
--
-- Every member of the Space sees its units; its owners arrange them.
do $$
begin
  if to_regclass('public.activity_spaces') is null or to_regclass('public.activity_space_members') is null
     or to_regclass('public.workers') is null then
    raise notice 'org_units skipped: a table it reads is not present'; return;
  end if;

  execute $f$
    create or replace function public.is_activity_space_owner(p_space uuid) returns boolean
    language sql stable security definer set search_path = public as $b$
      select exists (select 1 from activity_space_members m
        where m.activity_space_id = p_space and m.user_id = auth.uid() and m.role = 'owner')
    $b$
  $f$;
  execute 'revoke all on function public.is_activity_space_owner(uuid) from public';
  execute 'grant execute on function public.is_activity_space_owner(uuid) to authenticated';

  execute $t$
    create table if not exists public.org_units (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      parent_id uuid references public.org_units(id) on delete restrict,
      name text not null check (char_length(name) between 1 and 200),
      lead_worker_id uuid references public.workers(id) on delete set null,
      position integer not null default 0,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now()
    )$t$;
  execute 'create index if not exists org_units_space_idx on public.org_units(activity_space_id, parent_id, position)';

  execute $t$
    create table if not exists public.org_unit_members (
      unit_id uuid not null references public.org_units(id) on delete cascade,
      worker_id uuid not null references public.workers(id) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (unit_id, worker_id)
    )$t$;
  execute 'create index if not exists org_unit_members_worker_idx on public.org_unit_members(worker_id)';

  -- The parent is a unit of the same Space, and never the unit itself or one under it.
  execute $f$
    create or replace function public.org_units_check_parent() returns trigger
    language plpgsql set search_path = public as $b$
    declare
      cursor_id uuid := new.parent_id;
      hops int := 0;
    begin
      if new.parent_id is null then return new; end if;
      if not exists (select 1 from org_units p where p.id = new.parent_id and p.activity_space_id = new.activity_space_id) then
        raise exception 'A unit can only sit under a unit of the same Space.';
      end if;
      while cursor_id is not null loop
        if cursor_id = new.id then raise exception 'A unit cannot sit under itself or a unit inside it.'; end if;
        select parent_id into cursor_id from org_units where id = cursor_id;
        hops := hops + 1;
        if hops > 64 then raise exception 'Units are nested too deeply.'; end if;
      end loop;
      return new;
    end
    $b$
  $f$;
  execute 'drop trigger if exists org_units_check_parent on public.org_units';
  execute 'create trigger org_units_check_parent before insert or update of parent_id, activity_space_id on public.org_units for each row execute function public.org_units_check_parent()';

  execute 'alter table public.org_units enable row level security';
  execute 'alter table public.org_unit_members enable row level security';
  execute 'drop policy if exists org_units_read on public.org_units';
  execute 'drop policy if exists org_units_arrange on public.org_units';
  execute 'create policy org_units_read on public.org_units for select to authenticated using (public.is_activity_space_member(activity_space_id))';
  execute 'create policy org_units_arrange on public.org_units for all to authenticated using (public.is_activity_space_owner(activity_space_id)) with check (public.is_activity_space_owner(activity_space_id))';
  execute 'drop policy if exists org_unit_members_read on public.org_unit_members';
  execute 'drop policy if exists org_unit_members_arrange on public.org_unit_members';
  execute 'create policy org_unit_members_read on public.org_unit_members for select to authenticated using (exists (select 1 from public.org_units u where u.id = unit_id and public.is_activity_space_member(u.activity_space_id)))';
  execute 'create policy org_unit_members_arrange on public.org_unit_members for all to authenticated using (exists (select 1 from public.org_units u where u.id = unit_id and public.is_activity_space_owner(u.activity_space_id))) with check (exists (select 1 from public.org_units u where u.id = unit_id and public.is_activity_space_owner(u.activity_space_id)))';
  execute 'grant select, insert, update, delete on public.org_units to authenticated';
  execute 'grant select, insert, delete on public.org_unit_members to authenticated';

  -- Units change live for everyone looking at the Space.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'org_units') then
      execute 'alter publication supabase_realtime add table public.org_units';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'org_unit_members') then
      execute 'alter publication supabase_realtime add table public.org_unit_members';
    end if;
  end if;
end $$;
