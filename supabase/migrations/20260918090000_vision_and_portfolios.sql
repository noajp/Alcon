-- Strategy: Vision (one statement per Activity Space) and Portfolios
-- (named bundles of Initiatives within a Space). Guarded for preview replay.
do $$
begin
  if to_regclass('public.activity_spaces') is null then
    raise notice 'vision_and_portfolios skipped: activity_spaces not present';
    return;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'activity_spaces' and column_name = 'vision') then
    alter table public.activity_spaces add column vision text;
  end if;
  if to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'vision_and_portfolios: portfolios skipped, membership helper not present';
    return;
  end if;

  create table if not exists public.portfolios (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    name text not null,
    description text,
    order_index integer not null default 0,
    created_by uuid not null default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists portfolios_space_idx on public.portfolios (activity_space_id, order_index);
  alter table public.portfolios enable row level security;
  drop policy if exists portfolios_select on public.portfolios;
  create policy portfolios_select on public.portfolios for select to authenticated
    using (public.is_activity_space_member(activity_space_id));
  drop policy if exists portfolios_write on public.portfolios;
  create policy portfolios_write on public.portfolios for all to authenticated
    using (public.is_activity_space_member(activity_space_id))
    with check (public.is_activity_space_member(activity_space_id));

  if to_regclass('public.strategies') is not null and not exists (
    select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'strategies' and column_name = 'portfolio_id') then
    alter table public.strategies add column portfolio_id uuid references public.portfolios(id) on delete set null;
    create index if not exists strategies_portfolio_idx on public.strategies (portfolio_id);
  end if;

  begin
    alter publication supabase_realtime add table public.portfolios;
  exception when duplicate_object or undefined_object then null;
  end;
end
$$;

create or replace function public.touch_portfolios_updated_at()
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
  if to_regclass('public.portfolios') is null then return; end if;
  drop trigger if exists portfolios_touch_updated_at on public.portfolios;
  create trigger portfolios_touch_updated_at
    before update on public.portfolios
    for each row execute function public.touch_portfolios_updated_at();
end
$$;
