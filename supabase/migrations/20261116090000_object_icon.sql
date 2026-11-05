-- An Object can wear an icon of its own (a glyph key or an emoji), beside the
-- colour it already has. Null keeps the Object mark.
do $$
begin
  if to_regclass('public.objects') is null then
    raise notice 'objects.icon skipped: objects not present'; return;
  end if;
  execute 'alter table public.objects add column if not exists icon text';
end $$;
