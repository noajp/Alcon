-- An attached file edited in Alcon is saved as a new version: a new row
-- (and new bytes) that names the version it replaces. The row it replaces
-- stays, so the history can be read back; the listing shows the latest.
-- A version has one successor: two people saving at once cannot fork a
-- file, the second save fails and is applied again onto the first.
do $$
begin
  if to_regclass('public.element_files') is null then
    raise notice 'element file versions skipped: element_files not present'; return;
  end if;
  execute 'alter table public.element_files add column if not exists previous_id uuid references public.element_files(id) on delete set null';
  execute 'drop index if exists public.element_files_previous_idx';
  execute 'create unique index if not exists element_files_one_successor on public.element_files(previous_id) where previous_id is not null';
end $$;
