-- Element type + Domain-shared type list
--
-- `elements.type` stores a user-defined category (e.g. "Task", "Human")
-- selected from the Domain's shared list. Nullable to ease backfill; the
-- UI treats "no type" as an amber "Set type" prompt.
--
-- `domains.element_types` is the Domain-shared catalogue. JSONB array of
-- strings. The UI normalises the first character to uppercase on insert.

ALTER TABLE elements
  ADD COLUMN IF NOT EXISTS type text;

ALTER TABLE domains
  ADD COLUMN IF NOT EXISTS element_types jsonb NOT NULL DEFAULT '[]'::jsonb;
