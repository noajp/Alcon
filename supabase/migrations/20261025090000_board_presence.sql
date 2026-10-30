-- Who is looking at a board travels on a private Realtime channel named after
-- its subject, `board:<kind>:<id>`. Only people who can see the subject may
-- join it, see who else is there, or announce themselves (ADR 0041).
do $migration$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null
     or to_regprocedure('public.user_can_see_widget_subject(text, uuid)') is null then
    raise notice 'Board presence skipped: realtime or boards not present';
    return;
  end if;

  execute $ddl$
    create function public.board_presence_allowed(p_topic text)
    returns boolean language sql stable set search_path = '' as $fn$
      select case
        when p_topic ~ '^board:(domain|object|element|initiative):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then public.user_can_see_widget_subject(split_part(p_topic, ':', 2), split_part(p_topic, ':', 3)::uuid)
        else false
      end
    $fn$;
    revoke all on function public.board_presence_allowed(text) from public, anon;
    grant execute on function public.board_presence_allowed(text) to authenticated;

    create policy board_presence_receive on realtime.messages for select to authenticated
      using (realtime.messages.extension = 'presence' and public.board_presence_allowed((select realtime.topic())));
    create policy board_presence_announce on realtime.messages for insert to authenticated
      with check (realtime.messages.extension = 'presence' and public.board_presence_allowed((select realtime.topic())));
  $ddl$;
end $migration$;
