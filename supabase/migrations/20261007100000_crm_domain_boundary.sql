-- CRM records follow the Domain boundary (ELE_DEC-013).
-- A pipeline, company, contact or field may belong to a Domain. With a Domain,
-- it is visible to whoever can see that Domain — its members, its guests, and
-- Space members when the Domain is workspace-wide. Without one, it is shared
-- with the Space's members as before. Deals follow their pipeline; history
-- follows the deal, company or contact it is about. Deleting a Domain removes
-- its CRM records rather than handing private data to the whole Space.
do $$
begin
  if to_regclass('public.crm_pipelines') is null
     or to_regclass('public.domains') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null then
    raise notice 'crm domain boundary skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  alter table public.crm_pipelines add column if not exists domain_id uuid references public.domains(id) on delete cascade;
  alter table public.crm_companies add column if not exists domain_id uuid references public.domains(id) on delete cascade;
  alter table public.crm_contacts add column if not exists domain_id uuid references public.domains(id) on delete cascade;
  alter table public.crm_fields add column if not exists domain_id uuid references public.domains(id) on delete cascade;
  create index if not exists crm_pipelines_domain on public.crm_pipelines (domain_id);
  create index if not exists crm_companies_domain on public.crm_companies (domain_id);
  create index if not exists crm_contacts_domain on public.crm_contacts (domain_id);
  create index if not exists crm_fields_domain on public.crm_fields (domain_id);
  $ddl$;

  -- The one rule: a Domain record needs the Domain (in this Space) to be
  -- visible; a Space record needs Space membership.
  execute $ddl$
  create or replace function public.crm_scope_visible(p_space uuid, p_domain uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select case
      when p_domain is null then public.is_activity_space_member(p_space)
      else exists (select 1 from public.domains d where d.id = p_domain and d.activity_space_id = p_space)
           and public.user_can_see_domain(p_domain)
    end;
  $fn$;

  create or replace function public.crm_pipeline_visible(p_pipeline uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select coalesce((select public.crm_scope_visible(p.activity_space_id, p.domain_id) from public.crm_pipelines p where p.id = p_pipeline), false);
  $fn$;

  create or replace function public.crm_activity_visible(p_space uuid, p_deal uuid, p_company uuid, p_contact uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select case
      when p_deal is not null then coalesce((select public.crm_pipeline_visible(d.pipeline_id) from public.crm_deals d where d.id = p_deal), false)
      when p_company is not null then coalesce((select public.crm_scope_visible(c.activity_space_id, c.domain_id) from public.crm_companies c where c.id = p_company), false)
      when p_contact is not null then coalesce((select public.crm_scope_visible(c.activity_space_id, c.domain_id) from public.crm_contacts c where c.id = p_contact), false)
      else false
    end;
  $fn$;

  revoke all on function public.crm_scope_visible(uuid, uuid) from public, anon;
  revoke all on function public.crm_pipeline_visible(uuid) from public, anon;
  revoke all on function public.crm_activity_visible(uuid, uuid, uuid, uuid) from public, anon;
  grant execute on function public.crm_scope_visible(uuid, uuid) to authenticated;
  grant execute on function public.crm_pipeline_visible(uuid) to authenticated;
  grant execute on function public.crm_activity_visible(uuid, uuid, uuid, uuid) to authenticated;
  $ddl$;

  execute $ddl$
  do $inner$
  declare t text;
  begin
    foreach t in array array['crm_pipelines','crm_companies','crm_contacts','crm_fields'] loop
      execute format('drop policy if exists %I on public.%I', t || '_members', t);
      execute format('drop policy if exists %I on public.%I', t || '_visible', t);
      execute format('create policy %I on public.%I for all to authenticated using (public.crm_scope_visible(activity_space_id, domain_id)) with check (public.crm_scope_visible(activity_space_id, domain_id))', t || '_visible', t);
    end loop;
  end $inner$;

  drop policy if exists crm_deals_members on public.crm_deals;
  drop policy if exists crm_deals_visible on public.crm_deals;
  create policy crm_deals_visible on public.crm_deals for all to authenticated
    using (public.crm_pipeline_visible(pipeline_id)) with check (public.crm_pipeline_visible(pipeline_id));

  drop policy if exists crm_activities_read on public.crm_activities;
  drop policy if exists crm_activities_write on public.crm_activities;
  drop policy if exists crm_activities_delete on public.crm_activities;
  create policy crm_activities_read on public.crm_activities for select to authenticated
    using (public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id));
  create policy crm_activities_write on public.crm_activities for insert to authenticated
    with check (public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id) and kind <> 'stage');
  create policy crm_activities_delete on public.crm_activities for delete to authenticated
    using (public.crm_activity_visible(activity_space_id, deal_id, company_id, contact_id) and created_by = auth.uid() and kind <> 'stage');
  $ddl$;
end $$;
