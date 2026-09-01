-- Craft (the manual canvas editor + AI-assisted document/deck generator under
-- alcon/element/craft/) is removed: it had no live UI entry point, and the
-- user confirmed removing the code and this data rather than keeping it for
-- a future re-add.
--
-- studio_nodes held a small per-user folder/file tree (2 rows), studio_files
-- the generated content for each file node (1 row) — the whole feature's
-- storage. Nothing else references either table (verified: no other FK
-- points at studio_nodes or studio_files), so dropping studio_nodes cascades
-- cleanly onto studio_files without touching anything else.
--
-- Guarded per the to_regclass convention (see ops/README.md and every prior
-- migration touching a base table): PR preview branches replay this file
-- against an empty database, where these tables were never created, and an
-- unguarded DROP would fail with 42P01 rather than no-op.

do $$
begin
  if to_regclass('public.studio_nodes') is null then
    raise notice 'drop_craft_studio_tables skipped: studio_nodes not present';
    return;
  end if;
  execute 'drop table if exists public.studio_files cascade';
  execute 'drop table if exists public.studio_nodes cascade';
end $$;
