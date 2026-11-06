-- Artifacts become one folder tree per Space: folders nest without limit, and
-- a notebook or a slide deck can sit in a folder beside files.
--
-- * folders.parent_id: the folder it is in (null at the top). Nesting is the
--   only change; a folder's domain_id is no longer set by the app.
-- * notes.folder_id: the Artifacts folder a notebook (a top-level note) sits
--   in. A notebook stays visible only to whom it already was (notes RLS is
--   unchanged): putting it in a shared folder does not share it.
-- * decks.artifact_folder_id: the Artifacts folder a deck sits in. The Slides
--   app's own deck_folders stay as they are; each is copied once into an
--   Artifacts folder and its decks placed there.
do $$
begin
  if to_regclass('public.folders') is null then
    return;
  end if;

  alter table public.folders
    add column if not exists parent_id uuid references public.folders(id) on delete set null;
  create index if not exists folders_parent_id_idx on public.folders(parent_id);

  -- A folder cannot sit inside itself or anything under it.
  create or replace function public.folders_no_cycle()
  returns trigger
  language plpgsql
  set search_path = public
  as $fn$
  declare
    cur uuid := new.parent_id;
    depth int := 0;
  begin
    while cur is not null loop
      if cur = new.id then
        raise exception 'A folder cannot go inside itself.' using errcode = '23514';
      end if;
      depth := depth + 1;
      if depth > 1000 then
        raise exception 'Folders are nested too deep.' using errcode = '23514';
      end if;
      select parent_id into cur from public.folders where id = cur;
    end loop;
    return new;
  end
  $fn$;
  drop trigger if exists folders_no_cycle on public.folders;
  create trigger folders_no_cycle before insert or update of parent_id on public.folders
    for each row execute function public.folders_no_cycle();

  if to_regclass('public.notes') is not null then
    alter table public.notes
      add column if not exists folder_id uuid references public.folders(id) on delete set null;
    create index if not exists notes_folder_id_idx on public.notes(folder_id);
  end if;

  if to_regclass('public.decks') is not null then
    alter table public.decks
      add column if not exists artifact_folder_id uuid references public.folders(id) on delete set null;
    create index if not exists decks_artifact_folder_id_idx on public.decks(artifact_folder_id);

    -- Once: each Slides folder becomes an Artifacts folder holding its decks.
    if to_regclass('public.deck_folders') is not null
       and not exists (select 1 from public.decks where artifact_folder_id is not null) then
      create temporary table deck_folder_map on commit drop as
        select df.id as old_id, gen_random_uuid() as new_id, df.activity_space_id, df.name, df.position, df.created_by
        from public.deck_folders df;
      insert into public.folders (id, activity_space_id, name, position, created_by, app)
        select new_id, activity_space_id, left(coalesce(nullif(btrim(name), ''), 'Slides'), 200), round(position)::int, created_by, 'files'
        from deck_folder_map;
      update public.decks d set artifact_folder_id = m.new_id
        from deck_folder_map m where d.folder_id = m.old_id;
    end if;
  end if;
end $$;
