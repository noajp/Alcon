-- Renewals start from the contract, not from memory. A deal can carry the day
-- its contract renews or ends (renews_on); a renewal deal points back at the
-- deal it renews (renewal_of). A pipeline says how far ahead a renewal needs
-- attention (renewal_days) and which pipeline renewal deals go to
-- (renewal_pipeline_id; none means the same pipeline). A deal has at most one
-- renewal deal.
do $$
begin
  if to_regclass('public.crm_deals') is null or to_regclass('public.crm_pipelines') is null
     or to_regprocedure('public.crm_record_visible(text, uuid)') is null
     or to_regprocedure('public.crm_pipeline_visible(uuid)') is null then
    raise notice 'crm renewals skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  alter table public.crm_deals add column if not exists renews_on date;
  alter table public.crm_deals add column if not exists renewal_of uuid;
  do $inner$ begin
    if not exists (select 1 from pg_constraint where conname = 'crm_deals_renewal_of_fkey') then
      alter table public.crm_deals add constraint crm_deals_renewal_of_fkey
        foreign key (renewal_of, activity_space_id) references public.crm_deals(id, activity_space_id) on delete set null (renewal_of);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'crm_deals_renewal_not_self') then
      alter table public.crm_deals add constraint crm_deals_renewal_not_self check (renewal_of is null or renewal_of <> id);
    end if;
  end $inner$;
  -- One renewal per deal, even when two people start it at once or one of
  -- them cannot see the renewal already made.
  create unique index if not exists crm_deals_one_renewal on public.crm_deals (renewal_of) where renewal_of is not null;
  create index if not exists crm_deals_renews_on on public.crm_deals (activity_space_id, renews_on) where renews_on is not null;

  alter table public.crm_pipelines add column if not exists renewal_days integer not null default 90;
  alter table public.crm_pipelines add column if not exists renewal_pipeline_id uuid;
  do $inner$ begin
    if not exists (select 1 from pg_constraint where conname = 'crm_pipelines_renewal_days_check') then
      alter table public.crm_pipelines add constraint crm_pipelines_renewal_days_check check (renewal_days between 1 and 3650);
    end if;
    if not exists (select 1 from pg_constraint where conname = 'crm_pipelines_renewal_pipeline_fkey') then
      alter table public.crm_pipelines add constraint crm_pipelines_renewal_pipeline_fkey
        foreign key (renewal_pipeline_id, activity_space_id) references public.crm_pipelines(id, activity_space_id) on delete set null (renewal_pipeline_id);
    end if;
  end $inner$;

  -- A renewal may only point at a deal its writer can see, like a company or contact.
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
    if new.renewal_of is not null and (tg_op = 'INSERT' or new.renewal_of is distinct from old.renewal_of)
       and not coalesce((select public.crm_pipeline_visible(d.pipeline_id) from public.crm_deals d where d.id = new.renewal_of), false) then
      raise exception 'This deal is not visible to you' using errcode = '42501';
    end if;
    return new;
  end $fn$;
  revoke all on function public.crm_check_deal_links() from public, anon, authenticated;
  drop trigger if exists crm_deals_links on public.crm_deals;
  create trigger crm_deals_links before insert or update of company_id, contact_id, renewal_of on public.crm_deals
    for each row execute function public.crm_check_deal_links();
  $ddl$;
end $$;
