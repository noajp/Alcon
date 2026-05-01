-- =============================================
-- Server Room — servers + channels (Phase 1a)
-- =============================================
-- Adds the data model for the Server Room view.
--   servers   : 1 per System (system_id is the localStorage-side text id,
--               same convention as objects.system_id)
--   channels  : flat list within a server, kind = 'text' | 'voice'
--
-- RLS: owner-only via created_by = auth.uid(), matching the notes/briefs
-- convention. Membership-based access is deferred until private channels
-- and worker membership are introduced in a later phase.

-- ---------------------------------------------
-- Tables
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS servers (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id           text        NOT NULL,
  default_channel_id  uuid,
  created_by          uuid        NOT NULL DEFAULT auth.uid()
                                  REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (system_id, created_by)
);

CREATE TABLE IF NOT EXISTS channels (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id   uuid        NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('text', 'voice')),
  name        text        NOT NULL,
  topic       text,
  position    integer     NOT NULL DEFAULT 0,
  created_by  uuid        NOT NULL DEFAULT auth.uid()
                          REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- default_channel_id can only reference channels after that table exists
ALTER TABLE servers
  DROP CONSTRAINT IF EXISTS servers_default_channel_fk;
ALTER TABLE servers
  ADD CONSTRAINT servers_default_channel_fk
  FOREIGN KEY (default_channel_id)
  REFERENCES channels(id) ON DELETE SET NULL;

-- ---------------------------------------------
-- Indexes
-- ---------------------------------------------
CREATE INDEX IF NOT EXISTS idx_servers_system    ON servers(system_id);
CREATE INDEX IF NOT EXISTS idx_servers_owner     ON servers(created_by);
CREATE INDEX IF NOT EXISTS idx_channels_server   ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_channels_position ON channels(server_id, kind, position);
CREATE INDEX IF NOT EXISTS idx_channels_owner    ON channels(created_by);

-- ---------------------------------------------
-- updated_at auto-touch (reuse existing function)
-- ---------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS servers_set_updated_at ON servers;
CREATE TRIGGER servers_set_updated_at
  BEFORE UPDATE ON servers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS channels_set_updated_at ON channels;
CREATE TRIGGER channels_set_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------
-- RLS
-- ---------------------------------------------
ALTER TABLE servers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS servers_rw ON servers;
CREATE POLICY servers_rw ON servers
  FOR ALL
  USING      (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS channels_rw ON channels;
CREATE POLICY channels_rw ON channels
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM servers s WHERE s.id = server_id AND s.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM servers s WHERE s.id = server_id AND s.created_by = auth.uid())
  );
