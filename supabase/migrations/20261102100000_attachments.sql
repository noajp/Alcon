-- Attachments: a file attached to one thing in the Space — an Element, an
-- Object, an Initiative, a Portfolio, a CRM deal or a CRM company. The file
-- is evidence for what it is attached to, so it is seen by exactly those
-- who can see that thing (its own RLS decides), and goes with it when it is
-- deleted. element_files becomes attachments, with one owner column set
-- per row.
--
-- Removing a file moves it (every version of it) to a trash for 30 days;
-- anyone who can see what it is attached to can trash and restore it, and
-- once the days are up anyone who can see it may erase the rows and bytes.
-- Bytes stay in the element-files bucket: an upload goes under
-- "<owner kind>/<owner id>/…", and reading a file needs its row to be
-- visible.
do $$
declare
  owners text[][] := array[
    array['element_id', 'elements'], array['object_id', 'objects'], array['strategy_id', 'strategies'],
    array['portfolio_id', 'portfolios'], array['deal_id', 'crm_deals'], array['company_id', 'crm_companies']];
  o text[];
  present text[] := '{}';
  visible text := '';
  owner_visible text := '';
  kind text;
begin
  if to_regclass('public.element_files') is not null and to_regclass('public.attachments') is null then
    execute 'alter table public.element_files rename to attachments';
  end if;
  if to_regclass('public.attachments') is null then
    raise notice 'attachments skipped: element_files not present'; return;
  end if;

  execute 'alter table public.attachments alter column element_id drop not null';
  foreach o slice 1 in array owners loop
    if to_regclass('public.' || o[2]) is null then continue; end if;
    present := present || o[1];
    execute format('alter table public.attachments add column if not exists %I uuid references public.%I(id) on delete cascade', o[1], o[2]);
    execute format('create index if not exists %I on public.attachments(%I) where %I is not null', 'attachments_' || o[1] || '_idx', o[1], o[1]);
    visible := visible || format('%s(%I is not null and exists (select 1 from public.%I x where x.id = attachments.%I))',
      case when visible = '' then '' else ' or ' end, o[1], o[2], o[1]);
    kind := replace(o[1], '_id', '');
    owner_visible := owner_visible || format(' when %L then exists (select 1 from public.%I x where x.id::text = owner)', kind, o[2]);
  end loop;

  execute 'alter table public.attachments drop constraint if exists attachments_one_owner';
  execute format('alter table public.attachments add constraint attachments_one_owner check (num_nonnulls(%s) = 1)',
    (select string_agg(quote_ident(p), ', ') from unnest(present) p));
  execute 'alter index if exists public.element_files_one_successor rename to attachments_one_successor';
  execute 'create unique index if not exists attachments_path_key on public.attachments(path)';

  -- Whether the signed-in person can see an owner, named as it is in a
  -- storage path ("<kind>/<id>/…"): that thing's own RLS answers.
  execute format('create or replace function public.attachment_owner_visible(kind text, owner text) returns boolean language sql stable security invoker set search_path = public as %L',
    'select coalesce(case kind' || owner_visible || ' else false end, false)');

  -- Rows: seen with what they are attached to.
  for kind in select policyname from pg_policies where schemaname = 'public' and tablename = 'attachments' loop
    execute format('drop policy %I on public.attachments', kind);
  end loop;
  execute format('create policy "attachments select visible" on public.attachments for select to authenticated using (%s)', visible);
  execute format('create policy "attachments insert visible" on public.attachments for insert to authenticated with check (uploaded_by = (select auth.uid()) and (%s))', visible);
  execute format('create policy "attachments trash visible" on public.attachments for update to authenticated using (%s) with check ((%s) and (deleted_by is null or deleted_by = (select auth.uid())))', visible, visible);
  execute format($p$create policy "attachments erase expired" on public.attachments for delete to authenticated using ((%s) and deleted_at < now() - interval '30 days')$p$, visible);
  execute format('grant insert (%s) on public.attachments to authenticated', (select string_agg(quote_ident(p), ', ') from unnest(present) p));

  -- Bytes: read with a visible row; written under an owner one can see;
  -- erased by the uploader (a failed upload) or once the trash days are up.
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists "element files storage read" on storage.objects';
    execute 'drop policy if exists "element files storage insert" on storage.objects';
    execute 'drop policy if exists "element files storage delete" on storage.objects';
    execute 'drop policy if exists "attachments storage read" on storage.objects';
    execute 'drop policy if exists "attachments storage insert" on storage.objects';
    execute 'drop policy if exists "attachments storage delete" on storage.objects';
    execute $s$create policy "attachments storage read" on storage.objects for select to authenticated
      using (bucket_id = 'element-files' and exists (select 1 from public.attachments a where a.path = objects.name))$s$;
    -- Until the app reading element_files is gone from production, its
    -- uploads ("<element id>/…") are taken too (see the view below).
    execute $s$create policy "attachments storage insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'element-files' and owner = (select auth.uid())
        and (public.attachment_owner_visible((storage.foldername(name))[1], (storage.foldername(name))[2])
          or public.attachment_owner_visible('element', (storage.foldername(name))[1])))$s$;
    execute $s$create policy "attachments storage delete" on storage.objects for delete to authenticated
      using (bucket_id = 'element-files' and (owner = (select auth.uid())
        or exists (select 1 from public.attachments a where a.path = objects.name and a.deleted_at < now() - interval '30 days')))$s$;
  end if;

  -- The app deployed before this migration reads and writes element_files;
  -- it keeps working through this view (the reader's own RLS applies)
  -- until the next deploy, after which a later migration drops it.
  if to_regclass('public.element_files') is null then
    execute 'create view public.element_files with (security_invoker = true) as select * from public.attachments';
    execute 'grant select, insert, update, delete on public.element_files to authenticated';
  end if;

  -- Other people's uploads, versions and trash reach an open page live.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attachments') then
    execute 'alter publication supabase_realtime add table public.attachments';
  end if;
end $$;
