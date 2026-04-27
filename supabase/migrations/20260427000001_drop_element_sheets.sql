-- Remove the per-Object multi-sheet feature.
-- "1 Object = 1 sheet" is the new model — the dedicated sheet selector and
-- table are gone. Existing rows have already stopped reading sheet_id from
-- the UI; this migration tears down the storage so the schema matches.

-- Drop the FK column on elements first so the table can be dropped cleanly.
alter table public.elements
  drop column if exists sheet_id;

drop table if exists public.element_sheets cascade;
