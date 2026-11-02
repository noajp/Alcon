-- Who else has an attached file open: a private presence channel per file
-- ("file:<attachment id>"), which only those who can see the file (its
-- owner's RLS, through attachments') may join — as Notes' and boards' are.
do $$
begin
  if to_regclass('public.attachments') is null or to_regclass('realtime.messages') is null then
    raise notice 'file presence skipped: attachments or realtime.messages not present'; return;
  end if;
  execute $f$
    create or replace function public.file_presence_allowed(p_topic text)
    returns boolean language sql stable set search_path = '' as $body$
      select case
        when p_topic ~ '^file:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then exists (select 1 from public.attachments a where a.id = split_part(p_topic, ':', 2)::uuid)
        else false
      end
    $body$
  $f$;
  execute 'drop policy if exists file_presence_announce on realtime.messages';
  execute 'drop policy if exists file_presence_receive on realtime.messages';
  execute $p$create policy file_presence_announce on realtime.messages for insert to authenticated
    with check (extension = 'presence' and public.file_presence_allowed((select realtime.topic())))$p$;
  execute $p$create policy file_presence_receive on realtime.messages for select to authenticated
    using (extension = 'presence' and public.file_presence_allowed((select realtime.topic())))$p$;
end $$;
