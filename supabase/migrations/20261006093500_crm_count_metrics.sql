-- A pipeline can report how many deals were won (this quarter, this year, to
-- date) into a success condition counted in companies or deals, not only money.
do $$
begin
  if to_regclass('public.crm_pipelines') is null then raise notice 'crm_pipelines not present'; return; end if;
  execute $ddl$
  alter table public.crm_pipelines drop constraint if exists crm_pipelines_measure_metric_check;
  alter table public.crm_pipelines add constraint crm_pipelines_measure_metric_check check (measure_metric is null or measure_metric in
    ('won_quarter','won_year','won_total','weighted','open','won_count_quarter','won_count_year','won_count_total'));
  $ddl$;
end $$;
