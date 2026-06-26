-- ============================================================================
-- ActivitySpace — the top-level org container (company / enterprise) above
-- Domain. New hierarchy:  ActivitySpace → Domain → Object → Element.
--
-- Guarded so preview branches (which replay this folder on an EMPTY DB, with the
-- base schema — domains, profiles, … — absent) skip the domains-dependent steps
-- instead of erroring. New tables use `create table if not exists`; anything
-- that touches `public.domains` is wrapped in a to_regclass guard.
-- ============================================================================

-- 1. activity_spaces -----------------------------------------------------------
create table if not exists public.activity_spaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  identifier  text,                                  -- optional short slug
  color       text,
  order_index real not null default 0,
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. membership (mirrors domain_members) --------------------------------------
create table if not exists public.activity_space_members (
  activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  role              text not null default 'member',  -- 'owner' | 'member'
  created_at        timestamptz not null default now(),
  primary key (activity_space_id, user_id)
);

create index if not exists idx_activity_space_members_user
  on public.activity_space_members (user_id);

-- 3. RLS ----------------------------------------------------------------------
-- Membership test via a SECURITY DEFINER helper so the policies never recurse
-- through activity_space_members' own RLS (matches the user_owns_intent pattern).
create or replace function public.is_activity_space_member(p_space uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.activity_space_members
    where activity_space_id = p_space and user_id = auth.uid()
  );
$$;

create or replace function public.is_activity_space_owner(p_space uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.activity_space_members
    where activity_space_id = p_space and user_id = auth.uid() and role = 'owner'
  );
$$;

alter table public.activity_spaces        enable row level security;
alter table public.activity_space_members enable row level security;

-- activity_spaces: members read; creator inserts; owners update/delete.
drop policy if exists activity_spaces_select on public.activity_spaces;
create policy activity_spaces_select on public.activity_spaces
  -- `created_by` escape hatch so an insert().select() round-trips before the
  -- owner's membership row is written (same shape as domain creation).
  for select using (public.is_activity_space_member(id) or created_by = auth.uid());

drop policy if exists activity_spaces_insert on public.activity_spaces;
create policy activity_spaces_insert on public.activity_spaces
  for insert with check (created_by = auth.uid());

drop policy if exists activity_spaces_update on public.activity_spaces;
create policy activity_spaces_update on public.activity_spaces
  for update using (public.is_activity_space_owner(id));

drop policy if exists activity_spaces_delete on public.activity_spaces;
create policy activity_spaces_delete on public.activity_spaces
  for delete using (public.is_activity_space_owner(id));

-- activity_space_members: a member sees the roster of their spaces; a user can
-- enrol themselves (space creation) and owners can add/remove others.
drop policy if exists activity_space_members_select on public.activity_space_members;
create policy activity_space_members_select on public.activity_space_members
  for select using (public.is_activity_space_member(activity_space_id));

drop policy if exists activity_space_members_insert on public.activity_space_members;
create policy activity_space_members_insert on public.activity_space_members
  for insert with check (
    user_id = auth.uid() or public.is_activity_space_owner(activity_space_id)
  );

drop policy if exists activity_space_members_delete on public.activity_space_members;
create policy activity_space_members_delete on public.activity_space_members
  for delete using (
    user_id = auth.uid() or public.is_activity_space_owner(activity_space_id)
  );

-- 4. domains FK + backfill (guarded: base schema lives outside this folder) ----
do $$
declare
  r record;
  v_space uuid;
begin
  if to_regclass('public.domains') is null then
    return;  -- preview/empty DB: base schema absent, nothing to wire
  end if;

  -- Each Domain belongs to exactly one ActivitySpace.
  alter table public.domains
    add column if not exists activity_space_id uuid
    references public.activity_spaces(id) on delete set null;

  -- Index for filtering Domains by their ActivitySpace (re-run safe).
  drop index if exists public.idx_domains_activity_space;
  create index idx_domains_activity_space on public.domains (activity_space_id);

  -- Backfill: one "<name>'s Space" per distinct owner that still has unassigned
  -- Domains. Re-run safe — only touches domains with a null activity_space_id.
  for r in
    select d.user_id as owner,
           coalesce(max(p.display_name), 'My') as dname
    from public.domains d
    left join public.profiles p on p.id = d.user_id
    where d.user_id is not null and d.activity_space_id is null
    group by d.user_id
  loop
    insert into public.activity_spaces (name, created_by)
    values (r.dname || '''s Space', r.owner)
    returning id into v_space;

    insert into public.activity_space_members (activity_space_id, user_id, role)
    values (v_space, r.owner, 'owner')
    on conflict do nothing;

    update public.domains
    set activity_space_id = v_space
    where user_id = r.owner and activity_space_id is null;
  end loop;
  -- Owner-less domains (user_id null) keep a null space and can be re-homed later.
end $$;
