-- Close the Security Advisor findings on function grants, search_path and
-- public-bucket listing.
--
-- Function grants
--   * Trigger functions run when their trigger fires; firing does not check
--     EXECUTE, so no API role needs to call them through /rest/v1/rpc.
--   * Introspection helpers and the cron-driven notification generators are
--     for service_role / postgres only.
--   * Every other SECURITY DEFINER function is for signed-in callers: the RLS
--     helpers (user_can_see_*, is_activity_space_*) are evaluated as the
--     querying role, so authenticated keeps EXECUTE; anon loses it.
--   * New functions in public stop being granted to anon by default.
--
-- search_path
--   Plain (invoker) functions without a pinned search_path get
--   `public, pg_temp`, which is where their unqualified names already resolve.
--
-- Bucket listing
--   avatars / custom-view-assets / message-attachments are public buckets:
--   their files are read through public URLs, which bypass RLS. The broad
--   SELECT policies only let any client list every file. Each is narrowed to
--   the uploader's own files (avatars keeps the own-folder rule, which
--   upsert uploads need). custom-view-assets update/delete get the same
--   owner rule instead of "any signed-in user".
--
-- Not changed here: intentional signed-in RPCs (claim_element, invite_member,
-- ...) that the advisor lists as authenticated-executable, and
-- integration_oauth_states, which is service-role only by design.

do $$
declare
  r record;
  service_only constant text[] := array[
    'describe_function',
    'list_table_policies',
    'list_table_triggers',
    'generate_due_soon_notifications',
    'generate_review_due_notifications'
  ];
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;

  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (service_only)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
    execute format('grant execute on function %s to service_role', r.fn);
  end loop;

  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'trigger'::regtype
      and not (p.proname = any (service_only))
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon', r.fn);
    execute format('grant execute on function %s to authenticated, service_role', r.fn);
  end loop;

  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not p.prosecdef
      and l.lanname in ('plpgsql', 'sql')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.fn);
  end loop;

  execute 'alter default privileges for role postgres in schema public revoke execute on functions from anon';
end $$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'bucket listing skipped: storage.objects not present'; return;
  end if;

  execute 'drop policy if exists "Avatars are publicly readable" on storage.objects';
  execute 'drop policy if exists avatars_owner_read on storage.objects';
  execute $p$create policy avatars_owner_read on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

  execute 'drop policy if exists custom_view_assets_select on storage.objects';
  execute 'drop policy if exists custom_view_assets_owner_read on storage.objects';
  execute $p$create policy custom_view_assets_owner_read on storage.objects for select to authenticated
    using (bucket_id = 'custom-view-assets' and owner = (select auth.uid()))$p$;

  execute 'drop policy if exists custom_view_assets_update on storage.objects';
  execute $p$create policy custom_view_assets_update on storage.objects for update to authenticated
    using (bucket_id = 'custom-view-assets' and owner = (select auth.uid()))
    with check (bucket_id = 'custom-view-assets' and owner = (select auth.uid()))$p$;

  execute 'drop policy if exists custom_view_assets_delete on storage.objects';
  execute $p$create policy custom_view_assets_delete on storage.objects for delete to authenticated
    using (bucket_id = 'custom-view-assets' and owner = (select auth.uid()))$p$;

  execute 'drop policy if exists message_attachments_storage_read on storage.objects';
  execute 'drop policy if exists message_attachments_owner_read on storage.objects';
  execute $p$create policy message_attachments_owner_read on storage.objects for select to authenticated
    using (bucket_id = 'message-attachments' and owner = (select auth.uid()))$p$;
end $$;
