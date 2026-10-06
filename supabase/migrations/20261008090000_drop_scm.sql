-- The SCM App is gone from the product: drop its tables, functions and the
-- guard it put on domains. Every statement is guarded, so a preview branch
-- replaying onto an empty database is a no-op.

do $$
begin
  if to_regclass('public.domains') is not null then
    execute 'drop trigger if exists domains_scm_guard on public.domains';
  end if;
end $$;

drop table if exists
  public.scm_po_lines,
  public.scm_purchase_orders,
  public.scm_movements,
  public.scm_stock,
  public.scm_autopilot_runs,
  public.scm_policies,
  public.scm_items,
  public.scm_suppliers,
  public.scm_locations
  cascade;

do $$
declare fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'scm\_%'
  loop
    execute format('drop function if exists %s cascade', fn);
  end loop;
end $$;
