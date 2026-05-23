-- Element free-form labels
--
-- `elements.labels` is a JSONB array of free-form strings. Unlike `type`,
-- labels are per-element, optional, and have no Domain-shared catalogue.
-- Rendered as Tag-icon chips in both the list (Name cell) and detail
-- (Properties rail) surfaces.

ALTER TABLE elements
  ADD COLUMN IF NOT EXISTS labels jsonb NOT NULL DEFAULT '[]'::jsonb;
