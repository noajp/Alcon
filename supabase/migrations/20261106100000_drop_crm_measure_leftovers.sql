-- remove_crm dropped the CRM tables and the public CRM functions, but not the
-- measure refresh that lived in alcon_internal, nor its daily cron job. The
-- job now fails every night on the missing crm_pipelines; the functions can
-- no longer run. Remove both.
do $$
declare
  f regprocedure;
begin
  if to_regnamespace('cron') is not null
     and exists (select 1 from cron.job where jobname = 'crm-measures-daily') then
    perform cron.unschedule('crm-measures-daily');
  end if;

  if to_regnamespace('alcon_internal') is null then
    raise notice 'crm measure leftovers skipped: alcon_internal not present';
    return;
  end if;
  for f in
    select p.oid::regprocedure
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'alcon_internal' and p.proname like 'crm\_%'
  loop
    execute format('drop function %s', f);
  end loop;
end $$;
