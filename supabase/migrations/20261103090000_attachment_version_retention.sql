-- How long a file's earlier versions are kept. Every save keeps the whole
-- file, so versions would grow without end: a version is kept for 90 days,
-- and after that only while it is among the file's 10 newest. Anyone who can
-- see the file may erase a version past that (the bytes through the Storage
-- API, then the row), as the trash is erased.
do $$
begin
  if to_regclass('public.attachments') is null then
    raise notice 'attachment version retention skipped: attachments not present'; return;
  end if;

  -- Past keeping: replaced, older than 90 days, and with 10 newer versions.
  execute $f$
    create or replace function public.attachment_version_prunable(p_id uuid)
    returns boolean language sql stable security invoker set search_path = public as $body$
      select coalesce((
        select a.created_at < now() - interval '90 days'
          and (with recursive newer as (
                 select n.id from attachments n where n.previous_id = a.id
                 union all
                 select x.id from attachments x join newer on x.previous_id = newer.id
               ) select count(*) from newer) >= 10
        from attachments a where a.id = p_id
      ), false)
    $body$
  $f$;

  execute 'drop policy if exists "attachments prune old versions" on public.attachments';
  execute 'create policy "attachments prune old versions" on public.attachments for delete to authenticated
    using (public.attachment_version_prunable(id))';

  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "attachments storage delete" on storage.objects';
    execute $s$create policy "attachments storage delete" on storage.objects for delete to authenticated
      using (bucket_id = 'element-files' and (owner = (select auth.uid())
        or exists (select 1 from public.attachments a where a.path = objects.name
          and (a.deleted_at < now() - interval '30 days' or public.attachment_version_prunable(a.id)))))$s$;
  end if;
end $$;
