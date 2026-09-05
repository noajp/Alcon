-- objects.note_id — one Note pinned directly to an Object, mirroring
-- elements.note_id (Element detail already has this via NotePicker +
-- LinkedNoteEmbed). Object detail's Overview widget board gets the same
-- through a new opt-in 'linked-note' widget (WIDGET_REGISTRY) — not part of
-- the default board, so existing Overviews are unchanged until a user adds
-- it.
-- Guarded with to_regclass for preview/shadow-DB replay (base schema lives
-- outside this migrations folder).
do $$
begin
  if to_regclass('public.objects') is null or to_regclass('public.notes') is null then
    raise notice 'objects.note_id migration skipped: objects/notes not present';
    return;
  end if;
  execute 'alter table public.objects add column if not exists note_id uuid references public.notes(id) on delete set null';
end
$$;
