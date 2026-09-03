-- Settings > Elements > Templates (el_QLT-029). Element creation had no
-- saved shape at all — QuickAddElementPopup's "defaults" only ever came from
-- whatever group the user opened the popup from (its
-- defaultType/Status/Priority/AssigneeWorkerIds/Labels props), never from
-- something a Domain member deliberately set up and reused.
--
-- Domain-scoped: templates are a property of "how this Domain does its
-- work", the same shelf as element_types/label_colors/risk_thresholds. RLS
-- mirrors those: any Domain member can see and use a Domain's templates
-- (SELECT via user_can_see_domain, the same visibility a QuickAdd popup
-- already relies on to see the Domain at all), but only an owner/admin can
-- author them (user_has_domain_role, the same gate domains' own UPDATE
-- policy uses for element_types/label_colors/risk_thresholds).
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `domains`/the two helper functions live outside the
-- migrations folder (base schema).

do $migration$
begin
  if to_regclass('public.domains') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.user_has_domain_role(uuid,text[])') is null then
    raise notice 'element_templates skipped: base schema not present';
    return;
  end if;

  execute $sql$
    create table if not exists public.element_templates (
      id uuid primary key default gen_random_uuid(),
      domain_id uuid not null references public.domains(id) on delete cascade,
      name text not null,
      type text,
      status text,
      priority text,
      labels jsonb not null default '[]'::jsonb,
      assignee_worker_ids jsonb not null default '[]'::jsonb,
      description text,
      estimated_hours numeric,
      order_index integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $sql$;

  execute 'alter table public.element_templates enable row level security';

  execute 'drop policy if exists element_templates_select on public.element_templates';
  execute $sql$
    create policy element_templates_select on public.element_templates
      for select
      to authenticated
      using (user_can_see_domain(domain_id))
  $sql$;

  execute 'drop policy if exists element_templates_write on public.element_templates';
  execute $sql$
    create policy element_templates_write on public.element_templates
      for all
      to authenticated
      using (user_has_domain_role(domain_id, array['owner', 'admin']))
      with check (user_has_domain_role(domain_id, array['owner', 'admin']))
  $sql$;

  execute $sql$
    create or replace function public.touch_element_templates_updated_at()
    returns trigger
    language plpgsql
    set search_path = public, pg_catalog
    as $fn$
    begin
      new.updated_at = now();
      return new;
    end;
    $fn$;
  $sql$;

  execute 'drop trigger if exists element_templates_touch_updated_at on public.element_templates';
  execute $sql$
    create trigger element_templates_touch_updated_at
      before update on public.element_templates
      for each row
      execute function public.touch_element_templates_updated_at()
  $sql$;
end
$migration$;
