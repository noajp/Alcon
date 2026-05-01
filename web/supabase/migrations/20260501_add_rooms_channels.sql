-- =============================================
-- Room — rooms + channels (Phase 1a)
-- =============================================
-- Adds the data model for the Room view.
--   rooms     : 1 per System (system_id is the localStorage-side text id,
--               same convention as objects.system_id)
--   channels  : flat list within a room, kind = 'text' | 'voice'
--
-- RLS: owner-only via created_by = auth.uid(), matching the notes/briefs
-- convention. Membership-based access is deferred until private channels
-- and worker membership are introduced in a later phase.
--
-- Idempotent: drops the legacy `servers` table from the prior naming
-- (and any partial `rooms`) before recreating cleanly.

-- ---------------------------------------------
-- Drop legacy / re-runnable
-- ---------------------------------------------
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS servers  CASCADE;
DROP TABLE IF EXISTS rooms    CASCADE;

-- ---------------------------------------------
-- Tables
-- ---------------------------------------------
CREATE TABLE rooms (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id           text        NOT NULL,
  default_channel_id  uuid,
  created_by          uuid        NOT NULL DEFAULT auth.uid()
                                  REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (system_id, created_by)
);

CREATE TABLE channels (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id     uuid        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  kind        text        NOT NULL CHECK (kind IN ('text', 'voice')),
  name        text        NOT NULL,
  topic       text,
  position    integer     NOT NULL DEFAULT 0,
  created_by  uuid        NOT NULL DEFAULT auth.uid()
                          REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rooms
  ADD CONSTRAINT rooms_default_channel_fk
  FOREIGN KEY (default_channel_id)
  REFERENCES channels(id) ON DELETE SET NULL;

-- ---------------------------------------------
-- Indexes
-- ---------------------------------------------
CREATE INDEX idx_rooms_system        ON rooms(system_id);
CREATE INDEX idx_rooms_owner         ON rooms(created_by);
CREATE INDEX idx_channels_room       ON channels(room_id);
CREATE INDEX idx_channels_position   ON channels(room_id, kind, position);
CREATE INDEX idx_channels_owner      ON channels(created_by);

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

DROP TRIGGER IF EXISTS rooms_set_updated_at ON rooms;
CREATE TRIGGER rooms_set_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS channels_set_updated_at ON channels;
CREATE TRIGGER channels_set_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------
-- RLS
-- ---------------------------------------------
ALTER TABLE rooms     ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rooms_rw ON rooms;
CREATE POLICY rooms_rw ON rooms
  FOR ALL
  USING      (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS channels_rw ON channels;
CREATE POLICY channels_rw ON channels
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM rooms r WHERE r.id = room_id AND r.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM rooms r WHERE r.id = room_id AND r.created_by = auth.uid())
  );
