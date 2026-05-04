-- Drop the sections concept entirely. Items (elements / objects) live flat
-- inside their parent Object. Grouping becomes the view's responsibility — a
-- Linear-style group-by (status / priority / tag / etc.) will land later.

ALTER TABLE elements DROP COLUMN IF EXISTS section_id;
ALTER TABLE objects  DROP COLUMN IF EXISTS section_id;
DROP TABLE IF EXISTS sections;
