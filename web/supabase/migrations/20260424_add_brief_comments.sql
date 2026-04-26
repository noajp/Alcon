-- =============================================
-- Brief comments
-- =============================================
-- Lightweight reactions / quick remarks anchored to a Brief.
-- Each comment carries an author kind so AI agent comments can be
-- distinguished visually without a separate table.

CREATE TABLE IF NOT EXISTS brief_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brief_id    uuid        NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  author_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_kind text        NOT NULL DEFAULT 'human'
                          CHECK (author_kind IN ('human', 'ai_agent')),
  author_name text,
  content     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brief_comments_brief ON brief_comments(brief_id);

DROP TRIGGER IF EXISTS brief_comments_set_updated_at ON brief_comments;
CREATE TRIGGER brief_comments_set_updated_at
  BEFORE UPDATE ON brief_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE brief_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brief_comments_rw ON brief_comments;
CREATE POLICY brief_comments_rw ON brief_comments
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM briefs b
      WHERE b.id = brief_id AND b.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM briefs b
      WHERE b.id = brief_id AND b.created_by = auth.uid()
    )
  );
