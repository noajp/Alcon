-- Phase — Linear-Cycle-style time-boxed period, scoped to one Domain (mirrors
-- Linear's per-team cycles). A Phase has a name + date range; Objects and
-- Elements can be assigned to it via a nullable phase_id FK (mirrors how
-- Element already carries object_id — "which container is this row in" —
-- rather than a junction table, since an Object/Element sits in at most one
-- Phase at a time).
--
-- Guarded with to_regclass: preview branches replay supabase/migrations/ on
-- an EMPTY database (the base schema lives outside this folder), so the
-- whole block must no-op when the base tables are missing.

do $$
begin
  if to_regclass('public.domains') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.elements') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null then
    raise notice 'base tables/helpers missing - skipping phases migration (preview replay)';
    return;
  end if;

  if to_regclass('public.phases') is null then
    create table public.phases (
      id uuid primary key default gen_random_uuid(),
      domain_id uuid not null references public.domains(id) on delete cascade,
      name text not null,
      start_date date,
      end_date date,
      order_index integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index idx_phases_domain on public.phases(domain_id);

    alter table public.phases enable row level security;

    create policy "phases select visible" on public.phases
      for select using (user_can_see_domain(domain_id));
    create policy "phases insert visible" on public.phases
      for insert with check (auth.uid() is not null and user_can_see_domain(domain_id));
    create policy "phases update visible" on public.phases
      for update using (user_can_see_domain(domain_id));
    create policy "phases delete visible" on public.phases
      for delete using (user_can_see_domain(domain_id));
  end if;

  alter table public.objects
    add column if not exists phase_id uuid references public.phases(id) on delete set null;
  alter table public.elements
    add column if not exists phase_id uuid references public.phases(id) on delete set null;

  create index if not exists idx_objects_phase on public.objects(phase_id) where phase_id is not null;
  create index if not exists idx_elements_phase on public.elements(phase_id) where phase_id is not null;
end $$;
