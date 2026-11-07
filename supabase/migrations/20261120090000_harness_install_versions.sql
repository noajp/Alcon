-- Harnesses as installable packages: a catalog item carries a version; a
-- Space's installed copy records the version it came from and can be
-- turned off without being deleted.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.catalog_items') is not null then
    execute 'alter table public.catalog_items add column if not exists version integer not null default 1 check (version >= 1)';
    execute 'comment on column public.catalog_items.version is ''Catalog version. A migration that changes name, description or body of a row must also increment it.''';
  end if;

  if to_regclass('public.definitions') is not null then
    execute 'alter table public.definitions add column if not exists source_version integer check (source_version is null or source_version >= 1)';
    execute 'alter table public.definitions add column if not exists enabled boolean not null default true';
    execute 'create index if not exists definitions_space_enabled_idx on public.definitions (activity_space_id, enabled, name)';
  end if;

  -- A pre-versioning copy whose body is still byte-identical to the catalog
  -- item it came from is an unmodified copy of the current catalog version;
  -- record that. A copy whose body differs stays null: it is either locally
  -- edited or from an older, unversioned catalog body, and the UI must say
  -- "version not recorded" rather than guess.
  if to_regclass('public.catalog_items') is not null and to_regclass('public.definitions') is not null then
    execute $sql$
      update public.definitions d
      set source_version = c.version
      from public.catalog_items c
      where d.source_id = c.id
        and d.source_version is null
        and d.body = c.body
    $sql$;
  end if;
end $$;
