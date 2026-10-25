-- A counterpart can be part of the same organisation: an IT company's
-- customer that is also one of the Space's own Domains (a sister company, a
-- department billed internally). A company can name that Domain, so the record
-- and the Domain are known to be the same body and each leads to the other.
-- The Domain must be in the company's Space and visible to whoever sets it.
do $$
begin
  if to_regclass('public.crm_companies') is null
     or to_regclass('public.domains') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null then
    raise notice 'crm company own domain skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  alter table public.crm_companies add column if not exists own_domain_id uuid references public.domains(id) on delete set null;
  create index if not exists crm_companies_own_domain on public.crm_companies (own_domain_id) where own_domain_id is not null;

  create or replace function public.crm_check_own_domain() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if new.own_domain_id is null or (tg_op = 'UPDATE' and new.own_domain_id is not distinct from old.own_domain_id) then
      return new;
    end if;
    if not exists (select 1 from public.domains d where d.id = new.own_domain_id and d.activity_space_id = new.activity_space_id) then
      raise exception 'The Domain must be in this Space' using errcode = '23514';
    end if;
    if auth.uid() is not null and not public.user_can_see_domain(new.own_domain_id) then
      raise exception 'This Domain is not visible to you' using errcode = '42501';
    end if;
    return new;
  end $fn$;
  revoke all on function public.crm_check_own_domain() from public, anon, authenticated;
  drop trigger if exists crm_companies_own_domain on public.crm_companies;
  create trigger crm_companies_own_domain before insert or update of own_domain_id on public.crm_companies
    for each row execute function public.crm_check_own_domain();
  $ddl$;
end $$;
