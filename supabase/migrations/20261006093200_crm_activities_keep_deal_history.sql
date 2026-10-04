-- Deleting a company or contact must not erase the history of deals that stay.
-- Activities now lose only the link; entries that belonged to the deleted
-- record alone (no deal, no other record) go with it.
do $$
declare c record;
begin
  if to_regclass('public.crm_activities') is null then raise notice 'crm_activities not present'; return; end if;
  for c in select conname from pg_constraint where conrelid = 'public.crm_activities'::regclass and contype = 'f'
    and confrelid in ('public.crm_companies'::regclass, 'public.crm_contacts'::regclass) loop
    execute format('alter table public.crm_activities drop constraint %I', c.conname);
  end loop;
  execute $ddl$
  alter table public.crm_activities
    add constraint crm_activities_company_fk foreign key (company_id, activity_space_id) references public.crm_companies(id, activity_space_id) on delete set null (company_id),
    add constraint crm_activities_contact_fk foreign key (contact_id, activity_space_id) references public.crm_contacts(id, activity_space_id) on delete set null (contact_id);
  create or replace function public.crm_drop_record_only_activities() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    if tg_table_name = 'crm_companies' then
      delete from public.crm_activities where company_id = old.id and deal_id is null and (contact_id is null);
    else
      delete from public.crm_activities where contact_id = old.id and deal_id is null and (company_id is null);
    end if;
    return old;
  end $fn$;
  drop trigger if exists crm_companies_drop_activities on public.crm_companies;
  create trigger crm_companies_drop_activities before delete on public.crm_companies for each row execute function public.crm_drop_record_only_activities();
  drop trigger if exists crm_contacts_drop_activities on public.crm_contacts;
  create trigger crm_contacts_drop_activities before delete on public.crm_contacts for each row execute function public.crm_drop_record_only_activities();
  $ddl$;
end $$;
