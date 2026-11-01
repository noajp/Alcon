-- Removing an attached file moves it to a trash for 30 days instead of
-- erasing it: the row is marked deleted_at / deleted_by and the bytes stay
-- in storage, so the uploader can restore it. After 30 days the app erases
-- both (Storage refuses deletes made in SQL, so the purge goes through the
-- Storage API when the uploader next opens the Element).
--
-- Only the uploader may mark or unmark their file, and the update grant is
-- narrowed to those two columns so nothing else about a file can change.
do $$
begin
  if to_regclass('public.element_files') is null then
    raise notice 'element files trash skipped: element_files not present'; return;
  end if;

  execute 'alter table public.element_files add column if not exists deleted_at timestamptz';
  execute 'alter table public.element_files add column if not exists deleted_by uuid references auth.users(id) on delete set null';

  execute 'drop policy if exists "element files trash own" on public.element_files';
  execute 'create policy "element files trash own" on public.element_files for update to authenticated
    using (uploaded_by = (select auth.uid()))
    with check (uploaded_by = (select auth.uid()) and (deleted_by is null or deleted_by = (select auth.uid())))';

  execute 'revoke update on public.element_files from authenticated, anon';
  execute 'grant update (deleted_at, deleted_by) on public.element_files to authenticated';
end $$;
