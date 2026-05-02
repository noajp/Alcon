-- =============================================
-- Room — message reactions (Phase A)
-- =============================================
-- Adds emoji reactions on messages.
--   message_reactions : (message, user, emoji) tuple. Toggle by
--                       insert/delete from the UI.
--
-- RLS: read whoever can read the parent message (room owner);
-- insert/delete only your own row.

CREATE TABLE IF NOT EXISTS message_reactions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL DEFAULT auth.uid()
                          REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_user    ON message_reactions(user_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN channels c ON c.id = m.channel_id
      JOIN rooms r ON r.id = c.room_id
      WHERE m.id = message_id AND r.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS message_reactions_insert ON message_reactions;
CREATE POLICY message_reactions_insert ON message_reactions
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM messages m
      JOIN channels c ON c.id = m.channel_id
      JOIN rooms r ON r.id = c.room_id
      WHERE m.id = message_id AND r.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS message_reactions_delete ON message_reactions;
CREATE POLICY message_reactions_delete ON message_reactions
  FOR DELETE
  USING (user_id = auth.uid());

-- Realtime publication
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;

-- =============================================
-- Room — message attachments (Phase A)
-- =============================================
-- Stores file attachments for a message. Files themselves live in
-- Supabase Storage (`message-attachments` bucket).

CREATE TABLE IF NOT EXISTS message_attachments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid        NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  storage_path  text        NOT NULL,
  name          text        NOT NULL,
  mime          text,
  size_bytes    bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_attachments_select ON message_attachments;
CREATE POLICY message_attachments_select ON message_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN channels c ON c.id = m.channel_id
      JOIN rooms r ON r.id = c.room_id
      WHERE m.id = message_id AND r.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS message_attachments_insert ON message_attachments;
CREATE POLICY message_attachments_insert ON message_attachments
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM messages m
      JOIN channels c ON c.id = m.channel_id
      JOIN rooms r ON r.id = c.room_id
      WHERE m.id = message_id AND m.author_id = auth.uid() AND r.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS message_attachments_delete ON message_attachments;
CREATE POLICY message_attachments_delete ON message_attachments
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM messages m
      WHERE m.id = message_id AND m.author_id = auth.uid()
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE message_attachments;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;

-- =============================================
-- Storage bucket for message attachments
-- =============================================
-- Public-read so the URL produced by getPublicUrl() works without
-- a signed URL roundtrip. Restrict insert/delete to the file owner.

INSERT INTO storage.buckets (id, name, public)
VALUES ('message-attachments', 'message-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS message_attachments_storage_read ON storage.objects;
CREATE POLICY message_attachments_storage_read ON storage.objects
  FOR SELECT
  USING (bucket_id = 'message-attachments');

DROP POLICY IF EXISTS message_attachments_storage_insert ON storage.objects;
CREATE POLICY message_attachments_storage_insert ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND owner = auth.uid()
  );

DROP POLICY IF EXISTS message_attachments_storage_delete ON storage.objects;
CREATE POLICY message_attachments_storage_delete ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'message-attachments'
    AND owner = auth.uid()
  );
