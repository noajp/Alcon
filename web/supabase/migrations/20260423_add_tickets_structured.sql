-- =============================================
-- Tickets: add structured summary column
-- =============================================
-- Adds a jsonb column that holds the Loop-style meeting recap
-- (overview + decisions + action items + questions + participants).
-- Old tickets without this column fall back to the plain `summary` text.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS structured jsonb;
