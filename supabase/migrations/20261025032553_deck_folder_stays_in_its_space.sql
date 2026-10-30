-- A deck folder stays in its Space, like the decks in it (ADR 0042): moving
-- it would leave its decks pointing at a folder another Space now holds.
do $migration$
begin
  if to_regclass('public.deck_folders') is null then
    raise notice 'Deck folder trigger skipped: deck_folders absent';
    return;
  end if;

  execute $ddl$
    create or replace function public.deck_folder_stays_in_its_space() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if new.activity_space_id is distinct from old.activity_space_id then
        raise exception 'A deck folder cannot move to another Space';
      end if;
      new.updated_at := now();
      return new;
    end $fn$;
    drop trigger if exists deck_folder_stays_in_its_space on public.deck_folders;
    create trigger deck_folder_stays_in_its_space before update on public.deck_folders
      for each row execute function public.deck_folder_stays_in_its_space();
    revoke all on function public.deck_folder_stays_in_its_space() from public, anon;
  $ddl$;
end $migration$;
