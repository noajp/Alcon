-- Object milestones (◇ markers on the Strategy Timeline).
-- Each milestone is a single calendar date scoped to one Object.
-- Rendered above the Object band in the Timeline tab and editable
-- inline from the same view.

CREATE TABLE object_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_object_milestones_object ON object_milestones(object_id);

ALTER TABLE object_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY object_milestones_select ON object_milestones FOR SELECT USING (true);
CREATE POLICY object_milestones_modify ON object_milestones FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
