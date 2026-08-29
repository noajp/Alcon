-- element_comments never joined the supabase_realtime publication, so the
-- activity rollup's postgres_changes subscription (useElementActivity) heard
-- nothing — badges only refreshed when the visible set changed. Add it,
-- guarded and idempotent, same replay-safety shape as the sibling migrations.

do $$
begin
  if to_regclass('public.element_comments') is null then
    raise notice 'element_comments realtime skipped: table not present';
    return;
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'element_comments realtime skipped: publication not present';
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'element_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.element_comments';
  end if;
end
$$;
