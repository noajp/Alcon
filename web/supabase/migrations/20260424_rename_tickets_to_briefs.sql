-- =============================================
-- Rename tickets -> briefs
-- =============================================
-- Aligns the database with the renamed concept (Ticket -> Brief).
-- Brief works as both verb (to brief a Note) and noun (a Brief), and
-- fits more naturally alongside Note / Object / Element / Tag / Widget /
-- Worker. Existing rows are preserved.

ALTER TABLE tickets RENAME TO briefs;

-- Indexes (PostgreSQL keeps them functional after table rename, but the
-- internal names still point at "tickets". Rename for readability.)
ALTER INDEX IF EXISTS idx_tickets_source RENAME TO idx_briefs_source;
ALTER INDEX IF EXISTS idx_tickets_owner  RENAME TO idx_briefs_owner;

-- RLS policy
DROP POLICY IF EXISTS tickets_rw ON briefs;
DROP POLICY IF EXISTS briefs_rw  ON briefs;
CREATE POLICY briefs_rw ON briefs
  FOR ALL
  USING      (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
