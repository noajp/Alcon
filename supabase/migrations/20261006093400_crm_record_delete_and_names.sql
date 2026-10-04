-- Deleting a company or contact removes the history that belonged to it
-- alone, including entries other members logged (the caller has already been
-- allowed to delete the record; the trigger touches only rows tied to it).
-- Company names are not unique: two customers can share a name.
do $$
begin
  if to_regclass('public.crm_activities') is null then raise notice 'crm tables not present'; return; end if;
  execute $ddl$
  create or replace function public.crm_drop_record_only_activities() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if tg_table_name = 'crm_companies' then
      delete from public.crm_activities where company_id = old.id and deal_id is null and contact_id is null;
    else
      delete from public.crm_activities where contact_id = old.id and deal_id is null and company_id is null;
    end if;
    return old;
  end $fn$;
  revoke all on function public.crm_drop_record_only_activities() from public;
  revoke execute on function public.crm_drop_record_only_activities() from anon, authenticated;
  drop index if exists public.crm_companies_name;
  $ddl$;
end $$;
