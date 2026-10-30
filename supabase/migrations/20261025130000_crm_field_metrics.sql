-- A pipeline can report the sum of one of its own number fields (ARR, seats,
-- tonnes) over the deals it won — this quarter, this year or to date — into an
-- Initiative's success condition, not only amounts and counts.
do $$
begin
  if to_regclass('public.crm_pipelines') is null then
    raise notice 'crm field metrics skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  alter table public.crm_pipelines add column if not exists measure_field text;
  alter table public.crm_pipelines drop constraint if exists crm_pipelines_measure_metric_check;
  alter table public.crm_pipelines add constraint crm_pipelines_measure_metric_check check (measure_metric is null or measure_metric in (
    'won_quarter','won_year','won_total','weighted','open','won_count_quarter','won_count_year','won_count_total',
    'won_field_quarter','won_field_year','won_field_total'));
  do $inner$ begin
    if not exists (select 1 from pg_constraint where conname = 'crm_pipelines_measure_field_check') then
      alter table public.crm_pipelines add constraint crm_pipelines_measure_field_check
        check (measure_field is null or measure_field ~ '^[a-z0-9_]{1,40}$');
    end if;
  end $inner$;
  $ddl$;
end $$;
