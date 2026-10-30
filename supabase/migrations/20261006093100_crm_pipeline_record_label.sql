-- What an organisation calls a deal in a pipeline (案件, 引合, Opportunity…).
-- One of the few things a Space may rename; the record type stays standard.
do $$
begin
  if to_regclass('public.crm_pipelines') is null then
    raise notice 'crm_pipelines not present'; return;
  end if;
  execute $ddl$
  alter table public.crm_pipelines add column if not exists record_label text check (record_label is null or length(btrim(record_label)) between 1 and 40);
  comment on column public.crm_pipelines.record_label is 'What this organisation calls a deal in this pipeline (e.g. 案件, Opportunity). Null = the product default.';
  $ddl$;
end $$;
