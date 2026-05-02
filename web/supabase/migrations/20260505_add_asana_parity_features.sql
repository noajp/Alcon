-- =============================================
-- Asana feature parity — comments / reactions / notifications / approvals / time entries
-- =============================================
-- Adds the missing collaboration & workflow primitives:
--   * element_comments      — threaded comments on an Element (with @mentions)
--   * element_reactions     — emoji reactions on Element or Comment
--   * notifications         — Inbox feed (mentions, assignments, comments, approvals…)
--   * element_approvals     — approval state machine (pending/approved/changes/rejected)
--   * time_entries          — durations logged against an Element (timer + manual)
--
-- Element gets two extra columns to support approval workflow:
--   * is_approval boolean   — marks the element as an approval task
--   * approval_state text   — denormalized current state (matches latest approval row)

-- ---------------------------------------------------------------------------
-- 1. Element comments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS element_comments (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  element_id    uuid        NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  parent_id     uuid        REFERENCES element_comments(id) ON DELETE CASCADE,
  author_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_kind   text        NOT NULL DEFAULT 'human'
                            CHECK (author_kind IN ('human', 'ai_agent')),
  author_name   text,
  content       text        NOT NULL,
  mentions      uuid[]      NOT NULL DEFAULT '{}'::uuid[],
  is_pinned     boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_element_comments_element ON element_comments(element_id);
CREATE INDEX IF NOT EXISTS idx_element_comments_parent  ON element_comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_element_comments_author  ON element_comments(author_id);

DROP TRIGGER IF EXISTS element_comments_set_updated_at ON element_comments;
CREATE TRIGGER element_comments_set_updated_at
  BEFORE UPDATE ON element_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE element_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS element_comments_rw ON element_comments;
CREATE POLICY element_comments_rw ON element_comments
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. Reactions (emoji on element OR comment — exactly one target)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS element_reactions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  element_id    uuid        REFERENCES elements(id) ON DELETE CASCADE,
  comment_id    uuid        REFERENCES element_comments(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji         text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((element_id IS NOT NULL)::int + (comment_id IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_element_reactions_unique
  ON element_reactions(COALESCE(element_id, comment_id), user_id, emoji);

CREATE INDEX IF NOT EXISTS idx_element_reactions_element ON element_reactions(element_id);
CREATE INDEX IF NOT EXISTS idx_element_reactions_comment ON element_reactions(comment_id);

ALTER TABLE element_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS element_reactions_rw ON element_reactions;
CREATE POLICY element_reactions_rw ON element_reactions
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 3. Notifications (Inbox)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name    text,
  kind          text        NOT NULL
                            CHECK (kind IN (
                              'mention', 'assigned', 'comment',
                              'status_change', 'approval_requested',
                              'approval_decided', 'due_soon'
                            )),
  element_id    uuid        REFERENCES elements(id) ON DELETE CASCADE,
  comment_id    uuid        REFERENCES element_comments(id) ON DELETE CASCADE,
  object_id     uuid        REFERENCES objects(id) ON DELETE CASCADE,
  brief_id      uuid        REFERENCES briefs(id) ON DELETE CASCADE,
  title         text        NOT NULL,
  body          text,
  is_read       boolean     NOT NULL DEFAULT false,
  is_archived   boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created
  ON notifications(recipient_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select_own ON notifications;
CREATE POLICY notifications_select_own ON notifications
  FOR SELECT USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS notifications_insert_any ON notifications;
CREATE POLICY notifications_insert_any ON notifications
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS notifications_update_own ON notifications;
CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

DROP POLICY IF EXISTS notifications_delete_own ON notifications;
CREATE POLICY notifications_delete_own ON notifications
  FOR DELETE USING (recipient_id = auth.uid());

-- Realtime publication so the Inbox can subscribe
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Approvals
-- ---------------------------------------------------------------------------
ALTER TABLE elements
  ADD COLUMN IF NOT EXISTS is_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_state text
    CHECK (approval_state IN ('pending', 'approved', 'changes_requested', 'rejected'));

CREATE TABLE IF NOT EXISTS element_approvals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  element_id    uuid        NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  approver_id   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  approver_name text,
  state         text        NOT NULL
                            CHECK (state IN ('pending', 'approved', 'changes_requested', 'rejected')),
  note          text,
  decided_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_element_approvals_element ON element_approvals(element_id, decided_at DESC);

ALTER TABLE element_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS element_approvals_rw ON element_approvals;
CREATE POLICY element_approvals_rw ON element_approvals
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION sync_element_approval_state()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE elements
  SET approval_state = NEW.state,
      updated_at     = now()
  WHERE id = NEW.element_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS element_approvals_sync ON element_approvals;
CREATE TRIGGER element_approvals_sync
  AFTER INSERT ON element_approvals
  FOR EACH ROW EXECUTE FUNCTION sync_element_approval_state();

-- ---------------------------------------------------------------------------
-- 5. Time entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS time_entries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  element_id    uuid        NOT NULL REFERENCES elements(id) ON DELETE CASCADE,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name     text,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz,
  duration_sec  integer,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_time_entries_element ON time_entries(element_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_running
  ON time_entries(user_id) WHERE ended_at IS NULL;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS time_entries_rw ON time_entries;
CREATE POLICY time_entries_rw ON time_entries
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION close_time_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ended_at IS NOT NULL AND NEW.duration_sec IS NULL THEN
    NEW.duration_sec := EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at))::int;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS time_entries_close ON time_entries;
CREATE TRIGGER time_entries_close
  BEFORE INSERT OR UPDATE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION close_time_entry();

CREATE OR REPLACE FUNCTION roll_time_entry_to_element()
RETURNS TRIGGER AS $$
DECLARE
  total_sec bigint;
BEGIN
  SELECT COALESCE(SUM(duration_sec), 0) INTO total_sec
  FROM time_entries
  WHERE element_id = COALESCE(NEW.element_id, OLD.element_id)
    AND duration_sec IS NOT NULL;

  UPDATE elements
  SET actual_hours = ROUND((total_sec::numeric / 3600.0)::numeric, 2),
      updated_at   = now()
  WHERE id = COALESCE(NEW.element_id, OLD.element_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS time_entries_roll ON time_entries;
CREATE TRIGGER time_entries_roll
  AFTER INSERT OR UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION roll_time_entry_to_element();
