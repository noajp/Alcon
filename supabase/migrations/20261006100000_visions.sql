-- Strategy hierarchy: Vision → Portfolio (nests) → Initiative, the same
-- shape as Domain → Object → Element. A Space holds any number of Visions;
-- a Portfolio belongs to one Vision; an Initiative belongs to a Vision,
-- inside one of its Portfolios or directly. Guarded for preview replay.
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'visions skipped: base schema not present';
    return;
  end if;

  create table if not exists public.visions (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    name text not null,
    statement text,
    horizon date,
    narrative text,
    conditions jsonb not null default '[]'::jsonb,
    order_index integer not null default 0,
    created_by uuid not null default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists visions_space_idx on public.visions (activity_space_id, order_index);
  alter table public.visions enable row level security;
  drop policy if exists visions_select on public.visions;
  create policy visions_select on public.visions for select to authenticated
    using (public.is_activity_space_member(activity_space_id));
  drop policy if exists visions_insert on public.visions;
  create policy visions_insert on public.visions for insert to authenticated
    with check (public.is_activity_space_member(activity_space_id) and created_by = auth.uid());
  drop policy if exists visions_update on public.visions;
  create policy visions_update on public.visions for update to authenticated
    using (created_by = auth.uid() or public.is_activity_space_owner(activity_space_id))
    with check (created_by = auth.uid() or public.is_activity_space_owner(activity_space_id));
  drop policy if exists visions_delete on public.visions;
  create policy visions_delete on public.visions for delete to authenticated
    using (created_by = auth.uid() or public.is_activity_space_owner(activity_space_id));

  if to_regclass('public.portfolios') is not null and not exists (
    select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'portfolios' and column_name = 'vision_id') then
    alter table public.portfolios add column vision_id uuid references public.visions(id) on delete cascade;
    create index if not exists portfolios_vision_idx on public.portfolios (vision_id);
  end if;
  if to_regclass('public.strategies') is not null and not exists (
    select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'strategies' and column_name = 'vision_id') then
    alter table public.strategies add column vision_id uuid references public.visions(id) on delete set null;
    create index if not exists strategies_vision_idx on public.strategies (vision_id);
  end if;

  begin
    alter publication supabase_realtime add table public.visions;
  exception when duplicate_object or undefined_object then null;
  end;
end
$$;

create or replace function public.touch_visions_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.visions') is null then return; end if;
  drop trigger if exists visions_touch_updated_at on public.visions;
  create trigger visions_touch_updated_at
    before update on public.visions
    for each row execute function public.touch_visions_updated_at();
end
$$;

-- A Portfolio's Vision is in its own Space; a nested Portfolio sits in its
-- parent's Vision. The guard that keeps the parent chain sound enforces both
-- and fires on any write of vision_id as well.
create or replace function public.guard_portfolio_parent()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  cur uuid := new.parent_id;
  parent_space uuid;
  parent_vision uuid;
  vision_space uuid;
  hops integer := 0;
begin
  if new.parent_id is not null then
    perform pg_advisory_xact_lock(hashtext('portfolio-nesting:' || new.activity_space_id::text));
    if new.parent_id = new.id then
      raise exception 'a Portfolio cannot be its own parent' using errcode = '23514';
    end if;
    select activity_space_id, vision_id into parent_space, parent_vision from public.portfolios where id = new.parent_id;
    if parent_space is distinct from new.activity_space_id then
      raise exception 'a Portfolio nests only inside a Portfolio of the same Space' using errcode = '23514';
    end if;
    new.vision_id := parent_vision;
    while cur is not null loop
      if cur = new.id then
        raise exception 'a Portfolio cannot nest inside its own descendant' using errcode = '23514';
      end if;
      hops := hops + 1;
      if hops > 1000 then
        raise exception 'Portfolio nesting is too deep' using errcode = '23514';
      end if;
      select parent_id into cur from public.portfolios where id = cur;
    end loop;
  end if;
  if new.vision_id is not null then
    select activity_space_id into vision_space from public.visions where id = new.vision_id;
    if vision_space is distinct from new.activity_space_id then
      raise exception 'a Portfolio belongs to a Vision of its own Space' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- When a Portfolio's Vision changes, everything under it follows: the
-- Portfolios nested in it and the Initiatives it holds.
create or replace function public.propagate_portfolio_vision()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if new.vision_id is distinct from old.vision_id then
    update public.portfolios set vision_id = new.vision_id
      where parent_id = new.id and vision_id is distinct from new.vision_id;
    update public.strategies set vision_id = new.vision_id
      where portfolio_id = new.id and vision_id is distinct from new.vision_id;
  end if;
  return null;
end;
$$;

-- An Initiative in a Portfolio is in that Portfolio's Vision; a Vision can
-- only be named by a member of its Space.
create or replace function public.guard_strategy_vision()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  portfolio_vision uuid;
  vision_space uuid;
begin
  if new.portfolio_id is not null then
    select vision_id into portfolio_vision from public.portfolios where id = new.portfolio_id;
    new.vision_id := portfolio_vision;
  end if;
  if new.vision_id is not null and auth.uid() is not null
     and (tg_op = 'INSERT' or new.vision_id is distinct from old.vision_id) then
    select activity_space_id into vision_space from public.visions where id = new.vision_id;
    if vision_space is null or not public.is_activity_space_member(vision_space) then
      raise exception 'an Initiative is placed under a Vision of a Space you belong to' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.portfolios') is null or to_regclass('public.visions') is null then return; end if;
  drop trigger if exists portfolios_guard_parent on public.portfolios;
  create trigger portfolios_guard_parent
    before insert or update of parent_id, activity_space_id, vision_id on public.portfolios
    for each row execute function public.guard_portfolio_parent();
  drop trigger if exists portfolios_propagate_vision on public.portfolios;
  create trigger portfolios_propagate_vision
    after update of vision_id on public.portfolios
    for each row execute function public.propagate_portfolio_vision();
  if to_regclass('public.strategies') is not null then
    drop trigger if exists strategies_guard_vision on public.strategies;
    create trigger strategies_guard_vision
      before insert or update of vision_id, portfolio_id on public.strategies
      for each row execute function public.guard_strategy_vision();
  end if;
end
$$;

-- Carry what existed before Visions were rows: a Space's own Vision text and
-- its Portfolios become one Vision named after the Space; Initiatives in
-- those Portfolios follow.
do $$
declare
  has_text boolean;
begin
  if to_regclass('public.visions') is null or to_regclass('public.portfolios') is null then return; end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'activity_spaces' and column_name = 'vision_conditions') into has_text;
  if has_text then
    execute $q$
      insert into public.visions (activity_space_id, name, statement, horizon, narrative, conditions, created_by)
      select s.id, s.name, s.vision, s.vision_horizon, s.vision_narrative, coalesce(s.vision_conditions, '[]'::jsonb),
             coalesce((select m.user_id from public.activity_space_members m
                        where m.activity_space_id = s.id and m.role = 'owner' order by m.created_at limit 1), s.created_by)
        from public.activity_spaces s
       where not exists (select 1 from public.visions v where v.activity_space_id = s.id)
         and coalesce((select m.user_id from public.activity_space_members m
                        where m.activity_space_id = s.id and m.role = 'owner' order by m.created_at limit 1), s.created_by) is not null
         and (s.vision is not null or s.vision_horizon is not null or s.vision_narrative is not null
              or coalesce(s.vision_conditions, '[]'::jsonb) <> '[]'::jsonb
              or exists (select 1 from public.portfolios p where p.activity_space_id = s.id and p.vision_id is null))
    $q$;
  end if;
  update public.portfolios p
     set vision_id = (select v.id from public.visions v where v.activity_space_id = p.activity_space_id order by v.created_at limit 1)
   where p.vision_id is null and p.parent_id is null
     and exists (select 1 from public.visions v where v.activity_space_id = p.activity_space_id);
  if to_regclass('public.strategies') is not null then
    update public.strategies st set vision_id = p.vision_id
      from public.portfolios p
     where st.portfolio_id = p.id and st.vision_id is distinct from p.vision_id;
  end if;
end
$$;
