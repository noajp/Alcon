-- The app that read element_files is no longer deployed: drop the view
-- that kept it working, and take uploads only under "<owner kind>/<owner id>/".
do $$
begin
  if to_regclass('public.attachments') is null then
    raise notice 'attachments transition skipped: attachments not present'; return;
  end if;
  if exists (select 1 from pg_class where oid = to_regclass('public.element_files') and relkind = 'v') then
    execute 'drop view public.element_files';
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "attachments storage insert" on storage.objects';
    execute $s$create policy "attachments storage insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'element-files' and owner = (select auth.uid())
        and public.attachment_owner_visible((storage.foldername(name))[1], (storage.foldername(name))[2]))$s$;
  end if;
end $$;
