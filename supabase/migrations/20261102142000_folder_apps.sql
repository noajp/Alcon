-- A folder belongs to one app: Files' folders hold files, Table's folders
-- hold Tables. They are separate groupings (a Table is not a file), built
-- on the same folders.
do $$
begin
  if to_regclass('public.folders') is null then
    raise notice 'folder apps skipped: folders not present'; return;
  end if;
  execute $s$alter table public.folders add column if not exists app text not null default 'files'$s$;
  execute 'alter table public.folders drop constraint if exists folders_app_check';
  execute $s$alter table public.folders add constraint folders_app_check check (app in ('files', 'tables'))$s$;
  execute 'drop index if exists public.folders_space_idx';
  execute 'create index if not exists folders_space_app_idx on public.folders(activity_space_id, app, position)';
end $$;
