-- Re-allow Domain-direct Elements (Elements with no parent Object).
-- They surface only through the sidebar Elements view; per-Object lists
-- still show only their own Elements (via object_id) plus child Objects.
ALTER TABLE elements ALTER COLUMN object_id DROP NOT NULL;
