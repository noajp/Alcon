-- Files attached to an Element from the person's computer. They live in a
-- private bucket under the Element's id and are listed in element_files;
-- both answer to the Element's own visibility (the elements select policy,
-- evaluated as the caller), so whoever can see an Element can see, add and
-- download its files, and only the uploader removes one.
do $$
begin
  if to_regclass('public.elements') is null or to_regclass('storage.objects') is null then
    raise notice 'element files skipped: elements or storage not present'; return;
  end if;

  execute 'create table if not exists public.element_files (
    id uuid primary key default gen_random_uuid(),
    element_id uuid not null references public.elements(id) on delete cascade,
    path text not null unique,
    name text not null,
    size bigint not null default 0,
    mime_type text,
    uploaded_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
  )';
  execute 'create index if not exists element_files_element_idx on public.element_files(element_id, created_at)';
  execute 'alter table public.element_files enable row level security';

  execute 'drop policy if exists "element files select visible" on public.element_files';
  execute 'create policy "element files select visible" on public.element_files for select to authenticated
    using (exists (select 1 from public.elements e where e.id = element_id))';
  execute 'drop policy if exists "element files insert visible" on public.element_files';
  execute 'create policy "element files insert visible" on public.element_files for insert to authenticated
    with check (uploaded_by = (select auth.uid()) and exists (select 1 from public.elements e where e.id = element_id))';
  execute 'drop policy if exists "element files delete own" on public.element_files';
  execute 'create policy "element files delete own" on public.element_files for delete to authenticated
    using (uploaded_by = (select auth.uid()))';

  insert into storage.buckets (id, name, public, file_size_limit)
  values ('element-files', 'element-files', false, 52428800)
  on conflict (id) do nothing;

  -- Paths are "<element id>/<random>-<file name>": the first folder names
  -- the Element whose visibility decides.
  execute 'drop policy if exists "element files storage read" on storage.objects';
  execute $p$create policy "element files storage read" on storage.objects for select to authenticated
    using (bucket_id = 'element-files' and exists (
      select 1 from public.elements e where e.id::text = (storage.foldername(name))[1]))$p$;
  execute 'drop policy if exists "element files storage insert" on storage.objects';
  execute $p$create policy "element files storage insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'element-files' and owner = (select auth.uid()) and exists (
      select 1 from public.elements e where e.id::text = (storage.foldername(name))[1]))$p$;
  execute 'drop policy if exists "element files storage delete" on storage.objects';
  execute $p$create policy "element files storage delete" on storage.objects for delete to authenticated
    using (bucket_id = 'element-files' and owner = (select auth.uid()))$p$;
end $$;
