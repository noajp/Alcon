-- The completion bar under an Object's name is gone (Object Overview's default
-- band is empty and an Object no longer offers the widget). Boards saved while
-- it was the default still place it; those placements go, and a widget left
-- placed nowhere goes with them.
do $$
begin
  if to_regclass('public.board_placements') is null or to_regclass('public.boards') is null or to_regclass('public.widgets') is null then
    raise notice 'object-overview progress-band cleanup skipped: board tables not present'; return;
  end if;
  create temporary table object_progress_band_gone on commit drop as
    select p.id as placement_id, p.widget_id
    from public.board_placements p
    join public.boards b on b.id = p.board_id
    join public.widgets w on w.id = p.widget_id
    where b.surface = 'object-overview' and w.kind = 'progress-band';
  delete from public.board_placements where id in (select placement_id from object_progress_band_gone);
  -- A separate statement, so it sees the placements above as gone.
  delete from public.widgets w
  where w.id in (select widget_id from object_progress_band_gone)
    and not exists (select 1 from public.board_placements p where p.widget_id = w.id);
end $$;
