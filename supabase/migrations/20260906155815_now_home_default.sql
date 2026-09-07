-- Keep existing saved preferences; new users start from the daily work surface.
do $$
begin
  if to_regclass('public.user_preferences') is null then return; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'user_preferences' and column_name = 'home_view') then return; end if;
  alter table public.user_preferences drop constraint if exists user_preferences_home_view_check;
  alter table public.user_preferences add constraint user_preferences_home_view_check
    check (home_view in ('Now', 'My Elements', 'Inbox', 'Calendar', 'Campaign', 'Domain'));
  alter table public.user_preferences alter column home_view set default 'Now';
end $$;

-- Membership and multi-homing changes also invalidate the daily work snapshot.
do $$
declare v_table text;
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then return; end if;
  foreach v_table in array array['object_domains','activity_space_members','domain_members','object_members'] loop
    if to_regclass('public.' || v_table) is not null and not exists(
      select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
    ) then execute format('alter publication supabase_realtime add table public.%I',v_table); end if;
  end loop;
end $$;
