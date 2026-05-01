-- =============================================
-- Room — messages (Phase 2)
-- =============================================
-- Adds the messaging table behind text channels.
--   messages : append-only chat log per channel.
--
-- RLS: must belong (via channel -> room) to a room owned by the
-- current user. Author is auth.uid(). edited_at is set at write
-- time when a message is updated.
--
-- Realtime: messages is added to supabase_realtime so that the
-- client can subscribe to channel-scoped change feeds.

CREATE TABLE IF NOT EXISTS messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id   uuid        NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  body         text        NOT NULL,
  author_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_kind  text        NOT NULL DEFAULT 'human'
                           CHECK (author_kind IN ('human', 'ai_agent')),
  author_name  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_time ON messages(channel_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_author       ON messages(author_id);

-- ---------------------------------------------
-- RLS
-- ---------------------------------------------
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM channels c JOIN rooms r ON r.id = c.room_id
      WHERE c.id = channel_id AND r.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages
  FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM channels c JOIN rooms r ON r.id = c.room_id
      WHERE c.id = channel_id AND r.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS messages_update ON messages;
CREATE POLICY messages_update ON messages
  FOR UPDATE
  USING      (author_id = auth.uid())
  WITH CHECK (author_id = auth.uid());

DROP POLICY IF EXISTS messages_delete ON messages;
CREATE POLICY messages_delete ON messages
  FOR DELETE
  USING (author_id = auth.uid());

-- ---------------------------------------------
-- Realtime publication
-- ---------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    EXCEPTION WHEN duplicate_object THEN
      -- already added
      NULL;
    END;
  END IF;
END
$$;
