-- Keep existing saved preferences; new users start in the Inbox, the first
-- entry on the ModeRail.
do $$
begin
  if to_regclass('public.user_preferences') is null then return; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'user_preferences' and column_name = 'home_view') then return; end if;
  alter table public.user_preferences alter column home_view set default 'Inbox';
end $$;
