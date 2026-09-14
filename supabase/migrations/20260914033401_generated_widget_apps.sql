-- A placement is personal, so its generated application and inputs are personal too.
-- Object visibility is additionally checked through the caller's existing RLS.
do $$
begin
  if to_regclass('public.objects') is null then return; end if;
  execute $ddl$
    create table public.widget_apps (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
      object_id uuid not null references public.objects(id) on delete cascade,
      instance_id text not null check (length(instance_id) between 1 and 200),
      current_app jsonb,
      previous_app jsonb,
      draft_app jsonb,
      prompt text not null default '' check (length(prompt) <= 8000),
      revision integer not null default 1,
      updated_at timestamptz not null default now(),
      unique(owner_id, object_id, instance_id),
      check (octet_length(current_app::text) <= 150000),
      check (octet_length(previous_app::text) <= 150000),
      check (octet_length(draft_app::text) <= 150000)
    );
    create table public.widget_app_data (
      app_id uuid primary key references public.widget_apps(id) on delete cascade,
      value jsonb not null default '{}' check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 200000),
      revision integer not null default 1,
      updated_at timestamptz not null default now()
    );
    alter table public.widget_apps enable row level security;
    alter table public.widget_app_data enable row level security;
    revoke all on public.widget_apps, public.widget_app_data from anon, authenticated;
    grant select, insert, update, delete on public.widget_apps, public.widget_app_data to authenticated;
    create policy widget_apps_access on public.widget_apps for all to authenticated
      using (owner_id = (select auth.uid()) and exists(select 1 from public.objects o where o.id = object_id))
      with check (owner_id = (select auth.uid()) and exists(select 1 from public.objects o where o.id = object_id));
    create policy widget_app_data_access on public.widget_app_data for all to authenticated
      using (exists(select 1 from public.widget_apps a where a.id = app_id))
      with check (exists(select 1 from public.widget_apps a where a.id = app_id));
  $ddl$;
end $$;

create or replace function public.widget_app_revision() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_table_name = 'widget_apps' then
    if (new.owner_id is distinct from old.owner_id or new.object_id is distinct from old.object_id or new.instance_id is distinct from old.instance_id or new.id is distinct from old.id) then
      raise exception 'App identity cannot change';
    end if;
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.widget_app_revision() from public;
do $$
begin
  if to_regclass('public.widget_apps') is null then return; end if;
  execute 'create trigger widget_apps_revision before update on public.widget_apps for each row execute function public.widget_app_revision()';
  execute 'create trigger widget_app_data_revision before update on public.widget_app_data for each row execute function public.widget_app_revision()';
end $$;
