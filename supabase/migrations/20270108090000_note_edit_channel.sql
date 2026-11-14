-- Editing a Note together. Each Note has a broadcast channel `note-edit:<id>`
-- that carries the edits (Yjs updates) and where everyone's cursor is, between
-- the people who have it open. Only those who can write its body
-- (user_can_see_note — the same rule note_contents is written under) may send
-- on it or hear it, so nobody outside the Note sees it typed or can type into
-- someone else's copy.
--
-- Guarded: realtime and the Note visibility function live outside this folder.

do $$
begin
  if to_regclass('realtime.messages') is null
     or to_regprocedure('realtime.topic()') is null
     or to_regprocedure('public.user_can_see_note(uuid)') is null then
    raise notice 'note edit channel skipped: realtime or note visibility not present';
    return;
  end if;

  execute $ddl$
    create or replace function public.note_edit_channel_allowed(p_topic text)
    returns boolean language sql stable set search_path = '' as $fn$
      select case
        when p_topic ~ '^note-edit:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.user_can_see_note(split_part(p_topic, ':', 2)::uuid)
        else false
      end
    $fn$;
    revoke all on function public.note_edit_channel_allowed(text) from public, anon;
    grant execute on function public.note_edit_channel_allowed(text) to authenticated;
  $ddl$;

  execute 'drop policy if exists note_edit_receive on realtime.messages';
  execute 'drop policy if exists note_edit_send on realtime.messages';
  execute $p$create policy note_edit_receive on realtime.messages for select to authenticated
    using (realtime.messages.extension = 'broadcast' and public.note_edit_channel_allowed((select realtime.topic())))$p$;
  execute $p$create policy note_edit_send on realtime.messages for insert to authenticated
    with check (realtime.messages.extension = 'broadcast' and public.note_edit_channel_allowed((select realtime.topic())))$p$;
end $$;
