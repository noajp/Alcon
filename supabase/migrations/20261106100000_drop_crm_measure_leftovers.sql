-- remove_crm dropped the CRM tables and the public CRM functions, but not the
-- measure refresh that lived in alcon_internal, nor its daily cron job. The
-- job now fails every night on the missing crm_pipelines; the functions can
-- no longer run. Remove both.
do $$
declare
  f regprocedure;
  v_scheduled boolean := false;
begin
  -- cron.job is named only through execute: a preview database has no
  -- pg_cron, and a direct reference fails when the block is planned.
  if to_regclass('cron.job') is not null then
    execute 'select exists (select 1 from cron.job where jobname = ''crm-measures-daily'')' into v_scheduled;
    if v_scheduled then
      execute 'select cron.unschedule(''crm-measures-daily'')';
    end if;
  end if;

  if to_regnamespace('alcon_internal') is null then
    raise notice 'crm measure leftovers skipped: alcon_internal not present';
    return;
  end if;
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'alcon_internal'
      and (p.proname like 'crm\_%' or p.proname = 'intents_refresh_crm_measures')
  loop
    execute format('drop function %s', f);
  end loop;
end $$;
