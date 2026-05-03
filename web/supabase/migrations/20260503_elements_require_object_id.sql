-- Element must always belong to an Object (D > O > E philosophy).
-- Backfill any null object_id from the element_objects junction table first
-- (defensive — should be a no-op for fresh databases, but protects against
-- legacy rows that were created when object_id was nullable).
UPDATE elements e
SET object_id = j.object_id
FROM (
  SELECT DISTINCT ON (element_id) element_id, object_id
  FROM element_objects
  ORDER BY element_id, is_primary DESC NULLS LAST, created_at ASC NULLS LAST
) j
WHERE e.object_id IS NULL AND j.element_id = e.id;

-- Hard fail if any null object_id remains (truly orphan root elements with
-- no junction parent either) — surfaces a real data problem instead of
-- silently dropping rows.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT COUNT(*) INTO n FROM elements WHERE object_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'Cannot enforce NOT NULL: % elements still have a null object_id. Reassign or delete them first.', n;
  END IF;
END $$;

ALTER TABLE elements ALTER COLUMN object_id SET NOT NULL;
