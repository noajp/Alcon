-- Object type
--
-- `objects.type` mirrors `elements.type` so the same Domain-shared type
-- catalogue (`domains.element_types`) can label both Objects and Elements
-- in the unified list view. Nullable to allow gradual backfill; the UI
-- shows an amber "Set type" prompt when null.

ALTER TABLE objects
  ADD COLUMN IF NOT EXISTS type text;
