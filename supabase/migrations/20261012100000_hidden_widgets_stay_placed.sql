-- A widget can only be taken off a board by someone who can see it. Anyone on
-- the board could remove a placement before, including the empty frame of a
-- widget they cannot see — which left its author with a widget placed nowhere
-- and no way back to it (ADR 0039).
do $migration$
begin
  if to_regclass('public.boards') is null or to_regclass('public.board_placements') is null
     or to_regclass('public.widgets') is null then
    raise notice 'Hidden widget placements skipped: boards not present';
    return;
  end if;

  execute $ddl$
    drop policy board_placements_delete on public.board_placements;
    create policy board_placements_delete on public.board_placements for delete to authenticated
      using (exists (select 1 from public.boards b where b.id = board_id)
        and exists (select 1 from public.widgets w where w.id = widget_id));

    -- Deleting a board cascades past that rule, so a board is no longer
    -- deleted by hand: it goes with its subject, and a reset clears what the
    -- caller can see and leaves the rest where it was.
    drop policy boards_by_subject on public.boards;
    create policy boards_select on public.boards for select to authenticated
      using (public.user_can_see_widget_subject(subject_kind, subject_id));
    create policy boards_insert on public.boards for insert to authenticated
      with check (public.user_can_see_widget_subject(subject_kind, subject_id));
    create policy boards_update on public.boards for update to authenticated
      using (public.user_can_see_widget_subject(subject_kind, subject_id))
      with check (public.user_can_see_widget_subject(subject_kind, subject_id));
    revoke delete on public.boards from authenticated;

    create function public.reset_board(p_board_id uuid)
    returns void language plpgsql set search_path = '' as $fn$
    begin
      delete from public.board_placements where board_id = p_board_id;
      update public.boards set dismissed_defaults = '{}' where id = p_board_id;
      if not found then raise exception 'Board unavailable'; end if;
    end $fn$;
    revoke all on function public.reset_board(uuid) from public, anon;
    grant execute on function public.reset_board(uuid) to authenticated, service_role;
  $ddl$;
end $migration$;
