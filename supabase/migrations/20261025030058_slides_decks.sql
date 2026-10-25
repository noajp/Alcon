-- Slides: decks and the folders that hold them belong to a Space; its members
-- read and edit them (ADR 0042). A deck is the Slides editor's JSON — pages,
-- their logic and content — plus its look mix and its chat with the editor.
do $migration$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'Slides decks skipped: base schema absent';
    return;
  end if;

  execute $ddl$
    create table public.deck_folders (
      id text primary key check (length(id) between 1 and 64),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      name text not null check (length(name) between 1 and 200),
      position double precision not null default 0,
      created_by uuid default auth.uid(),
      updated_at timestamptz not null default now()
    );
    create index deck_folders_space on public.deck_folders (activity_space_id);

    create table public.decks (
      id text primary key check (length(id) between 1 and 64),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      folder_id text references public.deck_folders(id) on delete cascade,
      name text not null check (length(name) between 1 and 200),
      deck jsonb not null check (jsonb_typeof(deck) = 'object' and octet_length(deck::text) <= 8000000),
      mix jsonb not null default '{}'::jsonb check (jsonb_typeof(mix) = 'object'),
      chat jsonb not null default '[]'::jsonb check (jsonb_typeof(chat) = 'array' and octet_length(chat::text) <= 2000000),
      created_by uuid default auth.uid(),
      updated_by uuid default auth.uid(),
      updated_at timestamptz not null default now()
    );
    create index decks_space on public.decks (activity_space_id);

    -- A folder and its decks stay in one Space.
    create function public.deck_folder_same_space() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if new.folder_id is not null and not exists (
        select 1 from public.deck_folders f where f.id = new.folder_id and f.activity_space_id = new.activity_space_id
      ) then raise exception 'A deck and its folder must be in the same Space'; end if;
      if tg_op = 'UPDATE' and new.activity_space_id is distinct from old.activity_space_id then
        raise exception 'A deck cannot move to another Space';
      end if;
      new.updated_at := now();
      new.updated_by := (select auth.uid());
      return new;
    end $fn$;
    create trigger deck_folder_same_space before insert or update on public.decks
      for each row execute function public.deck_folder_same_space();

    alter table public.deck_folders enable row level security;
    alter table public.decks enable row level security;
    revoke all on public.deck_folders, public.decks from anon;
    grant select, insert, update, delete on public.deck_folders, public.decks to authenticated;
    grant all on public.deck_folders, public.decks to service_role;
    create policy deck_folders_members on public.deck_folders for all to authenticated
      using (public.is_activity_space_member(activity_space_id))
      with check (public.is_activity_space_member(activity_space_id));
    create policy decks_members on public.decks for all to authenticated
      using (public.is_activity_space_member(activity_space_id))
      with check (public.is_activity_space_member(activity_space_id));
    revoke all on function public.deck_folder_same_space() from public, anon;
  $ddl$;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.decks, public.deck_folders';
  end if;
end $migration$;
