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

-- A nested Portfolio sits in its parent's Vision: the guard that keeps the
-- parent chain sound also carries the Vision down.
create or replace function public.guard_portfolio_parent()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  cur uuid := new.parent_id;
  parent_space uuid;
  parent_vision uuid;
  hops integer := 0;
begin
  if new.parent_id is null then return new; end if;
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
  return new;
end;
$$;
