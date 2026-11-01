-- Pictures on Slides decks live in a private bucket, not inside the deck's
-- JSON: a deck row stays small enough to save and to reach other viewers
-- over Realtime. Each picture is stored once per Space under its content
-- hash ("<space id>/<sha-256>.<ext>"), so the same picture on many slides
-- or decks is one object, and a write of it is never a conflict. Who may
-- read or add one is who may see the Space's decks (decks_members).
-- Pictures are never deleted from here (an older version of a deck, or
-- another deck, may still show one).
do $$
begin
  if to_regclass('storage.objects') is null or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'deck assets skipped: storage or is_activity_space_member not present'; return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
    values ('deck-assets', 'deck-assets', false, 20971520)
    on conflict (id) do nothing;
  execute 'drop policy if exists "deck assets read" on storage.objects';
  execute $p$create policy "deck assets read" on storage.objects for select to authenticated
    using (bucket_id = 'deck-assets'
      and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_activity_space_member(((storage.foldername(name))[1])::uuid) else false end)$p$;
  execute 'drop policy if exists "deck assets insert" on storage.objects';
  execute $p$create policy "deck assets insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'deck-assets' and owner = (select auth.uid())
      and case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then public.is_activity_space_member(((storage.foldername(name))[1])::uuid) else false end)$p$;
end $$;
