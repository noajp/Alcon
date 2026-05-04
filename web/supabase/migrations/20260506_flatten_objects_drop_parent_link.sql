-- Flatten the Object hierarchy: Domain > Object > Element. There are no
-- nested Objects anymore.
--
-- 1. Backfill objects.domain_id for any orphans (rows that previously
--    surfaced under the active Domain via the orphan-fallback in code).
--    Pick the only existing Domain when there's exactly one; skip
--    otherwise (require manual handling for multi-domain workspaces).
DO $$
DECLARE
  d_id uuid;
BEGIN
  IF (SELECT COUNT(*) FROM domains) = 1 THEN
    SELECT id INTO d_id FROM domains LIMIT 1;
    UPDATE objects SET domain_id = d_id WHERE domain_id IS NULL;
  END IF;
END $$;

-- 2. Promote all child Objects to top-level. parent_object_id was the
--    legacy single-parent FK; nesting is gone now.
UPDATE objects SET parent_object_id = NULL WHERE parent_object_id IS NOT NULL;

-- 3. Drop the FK + column.
ALTER TABLE objects DROP CONSTRAINT IF EXISTS objects_parent_object_id_fkey;
ALTER TABLE objects DROP COLUMN IF EXISTS parent_object_id;

-- 4. Drop the multi-homing junction. Triggers / RLS / FKs that refer
--    to it will be dropped automatically by CASCADE.
DROP TABLE IF EXISTS object_parents CASCADE;
