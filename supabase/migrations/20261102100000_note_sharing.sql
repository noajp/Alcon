-- A Note follows what it is attached to: whoever can see the Element whose
-- Document it is, or the Object it belongs to (the Object's note, one of its
-- tabs, or a Note linked to it), can read and edit its body. A Note attached
-- to nothing stays its creator's own. Creating, renaming, moving and deleting
-- a Note stay with its creator.
--
-- Edits to a body arrive live (note_contents is published to Realtime, which
-- applies the same policies), and who has a Note open travels on a private
-- presence channel `note:<id>` that only those who can see the Note may join.
do $migration$
begin
  if to_regclass('public.notes') is null or to_regclass('public.note_contents') is null
     or to_regclass('public.elements') is null or to_regclass('public.objects') is null
     or to_regclass('public.object_tabs') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null then
    raise notice 'Note sharing skipped: notes, elements or objects not present';
    return;
  end if;

  execute $ddl$
    create or replace function public.user_can_see_note(_note_id uuid)
    returns boolean language sql stable security definer set search_path = '' as $fn$
      select
        exists (select 1 from public.notes n where n.id = _note_id
                  and (n.created_by = auth.uid()
                       or (n.linked_object_id is not null and public.user_can_see_object(n.linked_object_id))))
        or exists (select 1 from public.elements e where e.note_id = _note_id and public.user_can_see_element(e.id))
        or exists (select 1 from public.objects o where o.note_id = _note_id and public.user_can_see_object(o.id))
        or exists (select 1 from public.object_tabs t where t.note_id = _note_id and public.user_can_see_object(t.object_id))
    $fn$;
    revoke all on function public.user_can_see_note(uuid) from public, anon;
    grant execute on function public.user_can_see_note(uuid) to authenticated;
  $ddl$;

  execute 'create index if not exists idx_objects_note_id on public.objects(note_id) where note_id is not null';
  execute 'create index if not exists idx_notes_linked_object_id on public.notes(linked_object_id) where linked_object_id is not null';

  -- notes: read what you can see; the rest is the creator's.
  execute 'drop policy if exists notes_rw on public.notes';
  execute 'drop policy if exists notes_read on public.notes';
  execute 'drop policy if exists notes_own on public.notes';
  execute 'create policy notes_read on public.notes for select to authenticated using (public.user_can_see_note(id))';
  execute 'create policy notes_own on public.notes for all to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid())';

  -- note_contents: read and write the body of a Note you can see; only the
  -- creator removes it (with the Note).
  execute 'drop policy if exists note_contents_rw on public.note_contents';
  execute 'drop policy if exists note_contents_read on public.note_contents';
  execute 'drop policy if exists note_contents_insert on public.note_contents';
  execute 'drop policy if exists note_contents_update on public.note_contents';
  execute 'drop policy if exists note_contents_delete on public.note_contents';
  execute 'create policy note_contents_read on public.note_contents for select to authenticated using (public.user_can_see_note(note_id))';
  execute 'create policy note_contents_insert on public.note_contents for insert to authenticated with check (public.user_can_see_note(note_id))';
  execute 'create policy note_contents_update on public.note_contents for update to authenticated using (public.user_can_see_note(note_id)) with check (public.user_can_see_note(note_id))';
  execute $p$create policy note_contents_delete on public.note_contents for delete to authenticated
    using (exists (select 1 from public.notes n where n.id = note_contents.note_id and n.created_by = auth.uid()))$p$;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'note_contents') then
    execute 'alter publication supabase_realtime add table public.note_contents';
  end if;

  if to_regclass('realtime.messages') is not null and to_regprocedure('realtime.topic()') is not null then
    execute $ddl$
      create or replace function public.note_presence_allowed(p_topic text)
      returns boolean language sql stable set search_path = '' as $fn$
        select case
          when p_topic ~ '^note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then public.user_can_see_note(split_part(p_topic, ':', 2)::uuid)
          else false
        end
      $fn$;
      revoke all on function public.note_presence_allowed(text) from public, anon;
      grant execute on function public.note_presence_allowed(text) to authenticated;
    $ddl$;
    execute 'drop policy if exists note_presence_receive on realtime.messages';
    execute 'drop policy if exists note_presence_announce on realtime.messages';
    execute $p$create policy note_presence_receive on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'presence' and public.note_presence_allowed((select realtime.topic())))$p$;
    execute $p$create policy note_presence_announce on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'presence' and public.note_presence_allowed((select realtime.topic())))$p$;
  end if;
end $migration$;
