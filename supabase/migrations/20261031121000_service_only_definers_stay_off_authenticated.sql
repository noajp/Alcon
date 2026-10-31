-- function_grants_and_bucket_listing re-granted EXECUTE to authenticated on
-- every SECURITY DEFINER function it took off anon. These functions were
-- service_role only (secrets, PAT/OAuth resolution, asset relay, workflow
-- gateway); take authenticated back off them.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'announce_asset',
        'element_space',
        'get_integration_secret',
        'record_asset_events',
        'resolve_asset_token',
        'resolve_oauth_caller',
        'resolve_personal_access_token',
        'stash_integration_oauth_pending',
        'store_integration_oauth_token',
        'take_integration_oauth_pending',
        'touch_asset',
        'workflow_approval_redeem',
        'workflow_approval_request',
        'workflow_grants_table',
        'workflow_intake',
        'workflow_intake_reject',
        'workflow_step_outside_grant'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;
end $$;
