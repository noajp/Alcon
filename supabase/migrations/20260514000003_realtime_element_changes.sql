-- Enable Supabase realtime for the element-tree tables so list views update
-- without a page reload when sub-elements / status / assignees / custom-column
-- progress values change.
--
-- Idempotent: each table is checked against pg_publication_tables before being
-- added. Wrapped in the same "skip on preview replay" guard as the
-- agent_runs migration — if the parent tables haven't been created yet, this
-- migration becomes a no-op.

do $$
declare
  t text;
begin
  if to_regclass('public.elements') is null then
    raise notice 'realtime migration skipped: public.elements not present (preview replay?)';
    return;
  end if;

  foreach t in array array['elements','subelements','element_assignees','custom_column_values']
  loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;
