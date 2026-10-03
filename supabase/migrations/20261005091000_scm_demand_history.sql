-- Daily outflow per item and location, the planner's forecasting input.
-- Aggregated in the database so the browser reads one row per day instead of
-- every ledger row. Runs as the caller: RLS on scm_movements applies.
do $$
begin
  if to_regclass('public.scm_movements') is null then
    raise notice 'scm_demand_history skipped: scm_movements not present';
    return;
  end if;
  execute $ddl$
  create or replace function public.scm_demand_history(p_space uuid, p_since date)
  returns table (item_id uuid, location_id uuid, day date, quantity numeric)
  language sql stable security invoker set search_path = public as $fn$
    select m.item_id, m.location_id, m.occurred_on, sum(-m.quantity)
    from public.scm_movements m
    where m.activity_space_id = p_space
      and m.occurred_on >= p_since
      and m.kind in ('issue', 'transfer_out')
    group by m.item_id, m.location_id, m.occurred_on
    order by m.item_id, m.location_id, m.occurred_on
  $fn$;
  revoke all on function public.scm_demand_history(uuid, date) from public, anon;
  grant execute on function public.scm_demand_history(uuid, date) to authenticated;
  $ddl$;
end $$;
