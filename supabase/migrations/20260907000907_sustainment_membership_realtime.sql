-- Membership changes keep Sustainment scopes and rosters current.
-- The base schema may be absent during preview replay.
do $migration$
declare
  source_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  foreach source_table in array array[
    'domain_members', 'object_members', 'activity_space_members', 'object_domains'
  ] loop
    if to_regclass(format('public.%I', source_table)) is not null
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = source_table
      ) then
      execute format('alter publication supabase_realtime add table public.%I', source_table);
    end if;
  end loop;
end
$migration$;
