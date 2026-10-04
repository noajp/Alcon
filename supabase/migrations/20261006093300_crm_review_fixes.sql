-- CRM review fixes.
-- * A deal is dated won/lost on the day it closed (the client's local date
--   when it sends one), not on its expected close date.
-- * A logged call advances last contact even when the caller's local date is
--   ahead of the database's UTC date (mornings east of UTC).
-- * A Space gets one seeded pipeline even when two people open it at once.
-- * A company name is one record per Space.
do $$
begin
  if to_regclass('public.crm_deals') is null then raise notice 'crm tables not present'; return; end if;
  execute $ddl$
  create or replace function public.crm_number_deal() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    perform pg_advisory_xact_lock(hashtext('crm_deal:' || new.activity_space_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.crm_deals where activity_space_id = new.activity_space_id;
    if lower(new.stage) in ('won','lost') then new.closed_on := coalesce(new.closed_on, current_date); else new.closed_on := null; end if;
    return new;
  end $fn$;

  create or replace function public.crm_touch_deal() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    new.updated_at := now();
    if lower(new.stage) in ('won','lost') and lower(old.stage) not in ('won','lost') then
      new.closed_on := case when new.closed_on is distinct from old.closed_on and new.closed_on is not null then new.closed_on else current_date end;
    elsif lower(new.stage) not in ('won','lost') then
      new.closed_on := null;
    end if;
    return new;
  end $fn$;

  create or replace function public.crm_advance_contact() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    if new.deal_id is not null and new.kind in ('call','email','meeting') and new.occurred_on <= current_date + 1 then
      update public.crm_deals set last_contact_on = new.occurred_on
      where id = new.deal_id and (last_contact_on is null or last_contact_on < new.occurred_on);
    end if;
    return new;
  end $fn$;

  create unique index if not exists crm_pipelines_one_seed on public.crm_pipelines (activity_space_id) where order_index = 0;
  create unique index if not exists crm_companies_name on public.crm_companies (activity_space_id, lower(btrim(name)));
  $ddl$;
end $$;
