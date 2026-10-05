-- Stage history belongs to the deal. It names the deal's company only when
-- everyone who can see the deal can also see that company (the company is
-- Space-wide or in the pipeline's own Domain), so a company in a private Domain
-- never hides a Space deal's stage changes from the people working the deal.
do $$
begin
  if to_regclass('public.crm_deals') is null
     or to_regclass('public.crm_activities') is null then
    raise notice 'crm stage history scope skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create or replace function public.crm_log_stage() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare v_company uuid;
  begin
    if new.stage is distinct from old.stage then
      select c.id into v_company
        from public.crm_companies c join public.crm_pipelines p on p.id = new.pipeline_id
        where c.id = new.company_id and (c.domain_id is null or c.domain_id is not distinct from p.domain_id);
      insert into public.crm_activities (activity_space_id, deal_id, company_id, kind, body, occurred_on, created_by)
      values (new.activity_space_id, new.id, v_company, 'stage', old.stage || ' → ' || new.stage, current_date, auth.uid());
    end if;
    return new;
  end $fn$;
  $ddl$;
end $$;
