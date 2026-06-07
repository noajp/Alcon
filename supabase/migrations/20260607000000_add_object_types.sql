-- Object Type catalog, separate from Element types.
--
-- Objects (Project-level) and Elements (Task-level) previously shared one
-- catalog (domains.element_types), so Element types like "Task" leaked into the
-- Object Type picker. Give Objects their own `domains.object_types`.
--
-- Guarded with to_regclass so the migration is a no-op on a preview/shadow DB
-- where the base tables (domains/objects) aren't present.
do $$
begin
  if to_regclass('public.domains') is null then
    raise notice 'object_types migration skipped: domains not present';
    return;
  end if;

  execute 'alter table public.domains add column if not exists object_types text[] not null default ''{}''::text[]';

  -- Seed each Domain's object_types from the distinct Type values its Objects
  -- already use, so existing Object types survive the catalog split.
  if to_regclass('public.objects') is not null then
    execute $seed$
      update public.domains d
      set object_types = coalesce((
        select array_agg(distinct o.type order by o.type)
        from public.objects o
        where o.domain_id = d.id and o.type is not null and o.type <> ''
      ), '{}'::text[])
      where d.object_types = '{}'::text[]
    $seed$;
  end if;
end
$$;
