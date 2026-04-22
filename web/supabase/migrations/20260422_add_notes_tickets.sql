-- =============================================
-- Notes + Tickets (Notion-style page feature)
-- =============================================
-- Adds three tables behind the Action layer's Note / Ticket buttons:
--   notes          : folder/file tree (self-referential)
--   note_contents  : page body as BlockNote JSON, 1:1 with notes.file
--   tickets        : summarized snapshots extracted from a note
--
-- RLS: owner-only (auth.uid() = created_by). Broaden later when
-- team/system membership becomes a real thing in this app.

-- ---------------------------------------------
-- Tables
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text        NOT NULL CHECK (type IN ('folder', 'file')),
  name        text        NOT NULL DEFAULT 'Untitled',
  icon        text,
  parent_id   uuid        REFERENCES notes(id) ON DELETE CASCADE,
  order_index real        DEFAULT 0,
  created_by  uuid        NOT NULL DEFAULT auth.uid()
                          REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_contents (
  note_id     uuid        PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  blocks      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_note_id   uuid        REFERENCES notes(id) ON DELETE SET NULL,
  source_note_name text        NOT NULL,
  title            text        NOT NULL,
  summary          text        NOT NULL DEFAULT '',
  blocks_snapshot  jsonb,
  created_by       uuid        NOT NULL DEFAULT auth.uid()
                               REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------
-- Indexes
-- ---------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notes_parent     ON notes(parent_id);
CREATE INDEX IF NOT EXISTS idx_notes_owner      ON notes(created_by);
CREATE INDEX IF NOT EXISTS idx_tickets_source   ON tickets(source_note_id);
CREATE INDEX IF NOT EXISTS idx_tickets_owner    ON tickets(created_by);

-- ---------------------------------------------
-- updated_at auto-touch
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notes_set_updated_at ON notes;
CREATE TRIGGER notes_set_updated_at
  BEFORE UPDATE ON notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS note_contents_set_updated_at ON note_contents;
CREATE TRIGGER note_contents_set_updated_at
  BEFORE UPDATE ON note_contents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------
-- RLS
-- ---------------------------------------------
ALTER TABLE notes          ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_contents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notes_rw          ON notes;
CREATE POLICY notes_rw ON notes
  FOR ALL
  USING      (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS note_contents_rw  ON note_contents;
CREATE POLICY note_contents_rw ON note_contents
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.created_by = auth.uid())
  );

DROP POLICY IF EXISTS tickets_rw ON tickets;
CREATE POLICY tickets_rw ON tickets
  FOR ALL
  USING      (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
