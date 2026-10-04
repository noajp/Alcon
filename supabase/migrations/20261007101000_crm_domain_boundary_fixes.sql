-- The Domain boundary holds everywhere a CRM record can be reached from.
-- History is visible only when everything it is about is visible: a note on a
-- private contact stays private even when it also names a shared company.
-- Deal numbers come from the whole Space, not from the deals the writer can
-- see. A deal can only point at a company or contact its writer can see.
-- Fields are keyed per Domain, so two private Domains never collide. Moving a
-- record out of a Domain takes an owner or admin of that Domain, and a Domain
-- holding CRM records cannot be deleted until they are moved.
do $$
begin
  if to_regclass('public.crm_pipelines') is null
     or to_regclass('public.domains') is null
     or to_regprocedure('public.crm_scope_visible(uuid, uuid)') is null
     or to_regprocedure('public.user_has_domain_role(uuid, text[])') is null then
    raise notice 'crm domain boundary fixes skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create or replace function public.crm_activity_visible(p_space uuid, p_deal uuid, p_company uuid, p_contact uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select (p_deal is not null or p_company is not null or p_contact is not null)
      and (p_deal is null or coalesce((select d.activity_space_id = p_space and public.crm_pipeline_visible(d.pipeline_id) from public.crm_deals d where d.id = p_deal), false))
      and (p_company is null or coalesce((select c.activity_space_id = p_space and public.crm_scope_visible(c.activity_space_id, c.domain_id) from public.crm_companies c where c.id = p_company), false))
      and (p_contact is null or coalesce((select c.activity_space_id = p_space and public.crm_scope_visible(c.activity_space_id, c.domain_id) from public.crm_contacts c where c.id = p_contact), false));
  $fn$;

  create or replace function public.crm_record_visible(p_table text, p_id uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select p_id is null or coalesce(case p_table
      when 'company' then (select public.crm_scope_visible(c.activity_space_id, c.domain_id) from public.crm_companies c where c.id = p_id)
      when 'contact' then (select public.crm_scope_visible(c.activity_space_id, c.domain_id) from public.crm_contacts c where c.id = p_id)
    end, false);
  $fn$;
  revoke all on function public.crm_record_visible(text, uuid) from public, anon;
  grant execute on function public.crm_record_visible(text, uuid) to authenticated;

  -- Numbering reads every deal in the Space, including ones hidden from the writer.
  create or replace function public.crm_number_deal() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform pg_advisory_xact_lock(hashtext('crm_deal:' || new.activity_space_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.crm_deals where activity_space_id = new.activity_space_id;
    if lower(new.stage) in ('won','lost') then new.closed_on := coalesce(new.closed_on, current_date); else new.closed_on := null; end if;
    return new;
  end $fn$;
  revoke all on function public.crm_number_deal() from public, anon, authenticated;

  drop policy if exists crm_deals_visible on public.crm_deals;
  create policy crm_deals_visible on public.crm_deals for all to authenticated
    using (public.crm_pipeline_visible(pipeline_id))
    with check (public.crm_pipeline_visible(pipeline_id)
      and public.crm_record_visible('company', company_id)
      and public.crm_record_visible('contact', contact_id));

  alter table public.crm_fields drop constraint if exists crm_fields_activity_space_id_entity_key_key;
  create unique index if not exists crm_fields_scope_key on public.crm_fields
    (activity_space_id, entity, coalesce(domain_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

  create or replace function public.crm_guard_domain_move() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if new.domain_id is distinct from old.domain_id
       and old.domain_id is not null
       and auth.uid() is not null
       and not public.user_has_domain_role(old.domain_id, array['owner','admin']) then
      raise exception 'Only an owner or admin of this Domain can move its CRM records elsewhere'
        using errcode = '42501', hint = 'crm_domain_move';
    end if;
    return new;
  end $fn$;
  revoke all on function public.crm_guard_domain_move() from public, anon, authenticated;

  drop trigger if exists crm_pipelines_domain_move on public.crm_pipelines;
  drop trigger if exists crm_companies_domain_move on public.crm_companies;
  drop trigger if exists crm_contacts_domain_move on public.crm_contacts;
  drop trigger if exists crm_fields_domain_move on public.crm_fields;
  create trigger crm_pipelines_domain_move before update of domain_id on public.crm_pipelines for each row execute function public.crm_guard_domain_move();
  create trigger crm_companies_domain_move before update of domain_id on public.crm_companies for each row execute function public.crm_guard_domain_move();
  create trigger crm_contacts_domain_move before update of domain_id on public.crm_contacts for each row execute function public.crm_guard_domain_move();
  create trigger crm_fields_domain_move before update of domain_id on public.crm_fields for each row execute function public.crm_guard_domain_move();

  -- Deleting a Domain would cascade its CRM records away; refuse instead,
  -- unless the whole Space is going.
  create or replace function public.crm_guard_domain_delete() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if not exists (select 1 from public.activity_spaces where id = old.activity_space_id) then
      return old;
    end if;
    if exists (select 1 from public.crm_pipelines where domain_id = old.id)
       or exists (select 1 from public.crm_companies where domain_id = old.id)
       or exists (select 1 from public.crm_contacts where domain_id = old.id)
       or exists (select 1 from public.crm_fields where domain_id = old.id) then
      raise exception 'This Domain holds CRM pipelines, companies, contacts or fields. Move them to the Space or another Domain first.'
        using errcode = '23503', hint = 'domain_has_crm';
    end if;
    return old;
  end $fn$;
  revoke all on function public.crm_guard_domain_delete() from public, anon, authenticated;
  drop trigger if exists domains_crm_guard on public.domains;
  create trigger domains_crm_guard before delete on public.domains for each row execute function public.crm_guard_domain_delete();
  $ddl$;
end $$;
