-- Artifacts are split by who sees them, one tab each: Space (every member),
-- Domain (whoever sees that Domain), Object (whoever sees that Object) and My
-- (only you). The scope lives on the Artifacts folder; everything in a folder
-- — sub-folders, files, notebooks, decks — is seen by exactly those who see
-- the folder. Each tab has a root folder (made on first use) so that what sits
-- "at the top" of a tab is in a folder too.
--
-- Unchanged on purpose: Table's folders (app = 'tables') keep their old rule;
-- a notebook outside any Artifacts folder stays its creator's (it shows in My);
-- a deck outside any Artifacts folder stays the Space's (it shows in Space).
do $$
begin
  if to_regclass('public.folders') is null then
    return;
  end if;

  alter table public.folders
    add column if not exists scope text not null default 'space',
    add column if not exists object_id uuid references public.objects(id) on delete cascade,
    add column if not exists owner_id uuid references auth.users(id) on delete cascade,
    add column if not exists is_root boolean not null default false;

  alter table public.folders drop constraint if exists folders_scope_check;
  alter table public.folders add constraint folders_scope_check check (
    scope in ('space', 'domain', 'object', 'my')
    and (app <> 'files' or (
      (scope = 'space' and domain_id is null and object_id is null and owner_id is null)
      or (scope = 'domain' and domain_id is not null and object_id is null and owner_id is null)
      or (scope = 'object' and object_id is not null and domain_id is null and owner_id is null)
      or (scope = 'my' and owner_id is not null and domain_id is null and object_id is null)
    ))
  );

  -- One root per tab and subject.
  create unique index if not exists folders_one_root_idx on public.folders
    (activity_space_id, scope, coalesce(domain_id, object_id, owner_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where is_root and deleted_at is null;
  create index if not exists folders_object_id_idx on public.folders(object_id);
  create index if not exists folders_owner_id_idx on public.folders(owner_id);

  -- A folder inside another takes its Space, app and scope: who sees a folder
  -- is decided once, at the root of its tab.
  create or replace function public.folders_inherit_scope()
  returns trigger
  language plpgsql
  set search_path = public
  as $fn$
  declare
    p public.folders%rowtype;
  begin
    if new.parent_id is null then
      return new;
    end if;
    select * into p from public.folders where id = new.parent_id;
    if not found then
      return new;
    end if;
    new.activity_space_id := p.activity_space_id;
    new.app := p.app;
    new.scope := p.scope;
    new.domain_id := p.domain_id;
    new.object_id := p.object_id;
    new.owner_id := p.owner_id;
    new.is_root := false;
    return new;
  end
  $fn$;
  drop trigger if exists folders_inherit_scope on public.folders;
  create trigger folders_inherit_scope before insert or update of parent_id on public.folders
    for each row execute function public.folders_inherit_scope();

  -- Who sees an Artifacts folder of a given scope.
  create or replace function public.artifact_scope_visible(_space uuid, _scope text, _domain uuid, _object uuid, _owner uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
  as $fn$
    select public.is_activity_space_member(_space) and case _scope
      when 'space' then true
      when 'domain' then _domain is not null and public.user_can_see_domain(_domain)
      when 'object' then _object is not null and public.user_can_see_object(_object)
      when 'my' then _owner = auth.uid()
      else false
    end;
  $fn$;
  revoke all on function public.artifact_scope_visible(uuid, text, uuid, uuid, uuid) from public, anon;
  grant execute on function public.artifact_scope_visible(uuid, text, uuid, uuid, uuid) to authenticated;

  create or replace function public.user_can_see_artifact_folder(_folder_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
  as $fn$
    select exists (
      select 1 from public.folders f
      where f.id = _folder_id
        and (f.app <> 'files' and public.is_activity_space_member(f.activity_space_id)
             or f.app = 'files' and public.artifact_scope_visible(f.activity_space_id, f.scope, f.domain_id, f.object_id, f.owner_id))
    );
  $fn$;
  revoke all on function public.user_can_see_artifact_folder(uuid) from public, anon;
  grant execute on function public.user_can_see_artifact_folder(uuid) to authenticated;

  drop policy if exists folders_members on public.folders;
  drop policy if exists folders_visible on public.folders;
  create policy folders_visible on public.folders for all to authenticated
    using (
      case when app = 'files'
        then public.artifact_scope_visible(activity_space_id, scope, domain_id, object_id, owner_id)
        else public.is_activity_space_member(activity_space_id) end
    )
    with check (
      case when app = 'files'
        then public.artifact_scope_visible(activity_space_id, scope, domain_id, object_id, owner_id)
        else public.is_activity_space_member(activity_space_id) end
    );

  -- A deck in an Artifacts folder is seen by whoever sees the folder.
  if to_regclass('public.decks') is not null then
    drop policy if exists decks_members on public.decks;
    drop policy if exists decks_visible on public.decks;
    create policy decks_visible on public.decks for all to authenticated
      using (
        public.is_activity_space_member(activity_space_id)
        and (artifact_folder_id is null or public.user_can_see_artifact_folder(artifact_folder_id))
      )
      with check (
        public.is_activity_space_member(activity_space_id)
        and (artifact_folder_id is null or public.user_can_see_artifact_folder(artifact_folder_id))
      );
  end if;
end $$;

-- A note is also seen by whoever sees the Artifacts folder its notebook (the
-- top of its tree) sits in. Everything else about who sees a note is as before.
do $$
begin
  if to_regclass('public.notes') is null then
    return;
  end if;
  create or replace function public.user_can_see_note(_note_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path to ''
  as $fn$
    select
      exists (select 1 from public.notes n where n.id = _note_id
                and (n.created_by = auth.uid()
                     or (n.linked_object_id is not null and public.user_can_see_object(n.linked_object_id))))
      or exists (select 1 from public.elements e where e.note_id = _note_id and public.user_can_see_element(e.id))
      or exists (select 1 from public.objects o where o.note_id = _note_id and public.user_can_see_object(o.id))
      or exists (select 1 from public.object_tabs t where t.note_id = _note_id and public.user_can_see_object(t.object_id))
      or exists (
        with recursive up as (
          select n.id, n.parent_id, n.folder_id, 0 as depth from public.notes n where n.id = _note_id
          union all
          select p.id, p.parent_id, p.folder_id, up.depth + 1 from public.notes p join up on p.id = up.parent_id
          where up.depth < 16
        )
        select 1 from up
        where up.parent_id is null and up.folder_id is not null
          and public.user_can_see_artifact_folder(up.folder_id)
      )
  $fn$;
end $$;
