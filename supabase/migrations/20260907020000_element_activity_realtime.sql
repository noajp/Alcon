-- element_activity rides the delta stream, and says who wrote it itself.
--
-- The rail refetched only when the person looking at it changed something,
-- so a status row written by an agent (service role) or by SQL reached an
-- open Element only on reopen. Adding the table to supabase_realtime lets
-- deltaStream invalidate the rail the moment a row lands.
--
-- Who did it is not the client's to say. The INSERT policy lets any signed-in
-- viewer append, which is right — but it also let them pass any author and
-- actor_id. A BEFORE INSERT trigger stamps a signed-in insert with the
-- session's uid and the profile's display name; a write with no session (the
-- service role, the status trigger) keeps what it passed, because that path
-- is the one that knows the lease holder's token.
-- Guarded for preview/shadow-DB replay.
do $m$
begin
  if to_regclass('public.element_activity') is null then
    raise notice 'element_activity realtime skipped: table not present'; return;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'element_activity') then
    execute 'alter publication supabase_realtime add table public.element_activity';
  end if;

  execute $fn$
    create or replace function public.stamp_element_activity()
    returns trigger
    language plpgsql
    security definer
    set search_path to 'public'
    as $body$
    declare
      v_actor uuid := auth.uid();
      v_name text;
    begin
      if v_actor is not null then
        new.actor_id := v_actor;
        select p.display_name into v_name from profiles p where p.id = v_actor;
        if nullif(v_name, '') is not null then
          new.author := v_name;
        end if;
      end if;
      return new;
    end
    $body$
  $fn$;
  execute $trg$ drop trigger if exists trg_stamp_element_activity on public.element_activity $trg$;
  execute $trg$
    create trigger trg_stamp_element_activity
      before insert on public.element_activity
      for each row execute function public.stamp_element_activity()
  $trg$;
end
$m$;
