-- A short self-introduction shown on the Profile page.
do $$
begin
  if to_regclass('public.profiles') is null then return; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'profiles' and column_name = 'bio') then
    alter table public.profiles add column bio text;
  end if;
end $$;
