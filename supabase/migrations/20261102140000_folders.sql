-- Folders: a Space's own grouping — two levels, a folder and what is in
-- it, not a file system. Files' folders hold files of any kind; Table has
-- folders of its own for Tables (folder_apps). Every member of the Space
-- sees and arranges its folders.
--
-- A file uploaded into a folder is an attachment owned by that folder, so
-- versions, editing, the trash and search work as for any attachment. A
-- folder that still holds files cannot be deleted (its files would go with
-- it); a Table in a deleted folder just leaves the folder.
do $$
declare
  owners text[][] := array[
    array['element_id', 'elements'], array['object_id', 'objects'], array['strategy_id', 'strategies'],
    array['portfolio_id', 'portfolios'], array['deal_id', 'crm_deals'], array['company_id', 'crm_companies'],
    array['folder_id', 'folders']];
  o text[];
  present text[] := '{}';
  visible text := '';
  owner_visible text := '';
  kind text;
begin
  if to_regclass('public.activity_spaces') is null then
    raise notice 'folders skipped: activity_spaces not present'; return;
  end if;

  execute $t$
    create table if not exists public.folders (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      name text not null check (char_length(name) between 1 and 200),
      position integer not null default 0,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now()
    )$t$;
  execute 'create index if not exists folders_space_idx on public.folders(activity_space_id, position)';
  execute 'alter table public.folders enable row level security';
  execute 'drop policy if exists folders_members on public.folders';
  execute 'create policy folders_members on public.folders for all to authenticated using (public.is_activity_space_member(activity_space_id)) with check (public.is_activity_space_member(activity_space_id))';
  execute 'grant select, insert, update, delete on public.folders to authenticated';

  if to_regclass('public.tables') is not null then
    execute 'alter table public.tables add column if not exists folder_id uuid references public.folders(id) on delete set null';
    execute 'create index if not exists tables_folder_idx on public.tables(folder_id) where folder_id is not null';
  end if;

  if to_regclass('public.attachments') is null then
    raise notice 'folder attachments skipped: attachments not present'; return;
  end if;
  -- A folder holding files cannot be deleted from under them.
  execute 'alter table public.attachments add column if not exists folder_id uuid references public.folders(id) on delete restrict';
  execute 'create index if not exists attachments_folder_id_idx on public.attachments(folder_id) where folder_id is not null';
  -- Moving a file from one folder to another rewrites its folder.
  execute 'grant update (folder_id) on public.attachments to authenticated';

  -- Owners, visibility and the storage path check, now with folders.
  foreach o slice 1 in array owners loop
    if to_regclass('public.' || o[2]) is null then continue; end if;
    present := present || o[1];
    visible := visible || format('%s(%I is not null and exists (select 1 from public.%I x where x.id = attachments.%I))',
      case when visible = '' then '' else ' or ' end, o[1], o[2], o[1]);
    kind := replace(o[1], '_id', '');
    owner_visible := owner_visible || format(' when %L then exists (select 1 from public.%I x where x.id::text = owner)', kind, o[2]);
  end loop;
  execute 'alter table public.attachments drop constraint if exists attachments_one_owner';
  execute format('alter table public.attachments add constraint attachments_one_owner check (num_nonnulls(%s) = 1)',
    (select string_agg(quote_ident(p), ', ') from unnest(present) p));
  execute format('create or replace function public.attachment_owner_visible(kind text, owner text) returns boolean language sql stable security invoker set search_path = public as %L',
    'select coalesce(case kind' || owner_visible || ' else false end, false)');
  for kind in select policyname from pg_policies where schemaname = 'public' and tablename = 'attachments' loop
    execute format('drop policy %I on public.attachments', kind);
  end loop;
  execute format('create policy "attachments select visible" on public.attachments for select to authenticated using (%s)', visible);
  execute format('create policy "attachments insert visible" on public.attachments for insert to authenticated with check (uploaded_by = (select auth.uid()) and (%s))', visible);
  execute format('create policy "attachments trash visible" on public.attachments for update to authenticated using (%s) with check ((%s) and (deleted_by is null or deleted_by = (select auth.uid())))', visible, visible);
  execute format($p$create policy "attachments erase expired" on public.attachments for delete to authenticated using ((%s) and deleted_at < now() - interval '30 days')$p$, visible);
  execute format('grant insert (%s) on public.attachments to authenticated', (select string_agg(quote_ident(p), ', ') from unnest(present) p));

  -- Folders change live for everyone looking at the Space.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'folders') then
    execute 'alter publication supabase_realtime add table public.folders';
  end if;
end $$;
