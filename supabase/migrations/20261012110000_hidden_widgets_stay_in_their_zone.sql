-- A widget changes zone only at the hands of someone who can see it. Anyone on
-- the board could move the empty frame of a widget they cannot see into a zone
-- its kind does not fit — where its author's board drops it, with no way to
-- move it back (ADR 0039). Reordering within its zone stays open to the board.
do $migration$
begin
  if to_regclass('public.board_placements') is null or to_regclass('public.widgets') is null
     or to_regprocedure('public.board_placement_guard()') is null then
    raise notice 'Hidden widget zones skipped: boards not present';
    return;
  end if;

  execute $ddl$
    create or replace function public.board_placement_guard() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if new.id is distinct from old.id or new.board_id is distinct from old.board_id
         or new.widget_id is distinct from old.widget_id or new.default_id is distinct from old.default_id then
        raise exception 'Placement identity cannot be changed';
      end if;
      -- Runs as the caller, so this sees only the widgets they can.
      if new.zone is distinct from old.zone
         and not exists (select 1 from public.widgets w where w.id = new.widget_id) then
        raise exception 'A widget you cannot see cannot be moved to another zone';
      end if;
      new.updated_at := now();
      new.updated_by := (select auth.uid());
      return new;
    end $fn$;
  $ddl$;
end $migration$;
