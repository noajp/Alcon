-- Deleting a folder hides it rather than erasing it, once nothing in it is
-- live: its files in the trash still belong to it (and can be restored,
-- bringing the folder back), and its Tables show out of any folder.
do $$
begin
  if to_regclass('public.folders') is null then
    raise notice 'folder soft delete skipped: folders not present'; return;
  end if;
  execute 'alter table public.folders add column if not exists deleted_at timestamptz';
end $$;
