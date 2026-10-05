-- A deal's company and contact are checked when they are set, not on every
-- write. A company that later moves into a private Domain leaves Space-wide
-- deals that point at it editable by everyone who can see the deal. A field key
-- is also unique across the Space-wide fields and every Domain's fields of the
-- same entity, since a Domain record shows both and they would share one value.
do $$
begin
  if to_regclass('public.crm_deals') is null
     or to_regclass('public.crm_fields') is null
     or to_regprocedure('public.crm_record_visible(text, uuid)') is null then
    raise notice 'crm deal links skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  drop policy if exists crm_deals_visible on public.crm_deals;
  create policy crm_deals_visible on public.crm_deals for all to authenticated
    using (public.crm_pipeline_visible(pipeline_id)) with check (public.crm_pipeline_visible(pipeline_id));

  create or replace function public.crm_check_deal_links() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if auth.uid() is null then return new; end if;
    if (tg_op = 'INSERT' or new.company_id is distinct from old.company_id)
       and not public.crm_record_visible('company', new.company_id) then
      raise exception 'This company is not visible to you' using errcode = '42501';
    end if;
    if (tg_op = 'INSERT' or new.contact_id is distinct from old.contact_id)
       and not public.crm_record_visible('contact', new.contact_id) then
      raise exception 'This contact is not visible to you' using errcode = '42501';
    end if;
    return new;
  end $fn$;
  revoke all on function public.crm_check_deal_links() from public, anon, authenticated;
  drop trigger if exists crm_deals_links on public.crm_deals;
  create trigger crm_deals_links before insert or update of company_id, contact_id on public.crm_deals
    for each row execute function public.crm_check_deal_links();

  create or replace function public.crm_check_field_key() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform pg_advisory_xact_lock(hashtext('crm_field:' || new.activity_space_id::text || ':' || new.entity || ':' || new.key));
    if exists (select 1 from public.crm_fields f
               where f.activity_space_id = new.activity_space_id and f.entity = new.entity and f.key = new.key
                 and f.id <> new.id and (f.domain_id is null or new.domain_id is null or f.domain_id = new.domain_id)) then
      raise exception 'A field with this key already exists' using errcode = '23505';
    end if;
    return new;
  end $fn$;
  revoke all on function public.crm_check_field_key() from public, anon, authenticated;
  drop trigger if exists crm_fields_key_scope on public.crm_fields;
  create trigger crm_fields_key_scope before insert or update of key, domain_id, entity on public.crm_fields
    for each row execute function public.crm_check_field_key();
  $ddl$;
end $$;
