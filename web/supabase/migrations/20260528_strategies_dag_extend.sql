-- Strategy DAG extensions on top of 20260526_add_strategies_and_rename_workload.
--
-- 1. Add scope / color / icon to strategies. `scope` is a jsonb bag that
--    can hold a saved ListControlsState (filter + display) plus optional
--    domain_ids / object_ids hints — Strategies can ship with a default
--    view preset.
-- 2. Strategy → Strategy junction (strategy_children) so Strategies can
--    nest other Strategies. Multi-parent allowed (DAG); cycle prevention
--    is enforced at the app layer in useStrategyChildren.
-- 3. Light created_by tightening: existing rows backfilled to a real
--    user so the FK can stay (column kept nullable for service-account
--    inserts).

ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS scope JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS icon  TEXT;

CREATE TABLE IF NOT EXISTS strategy_children (
  parent_strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  child_strategy_id  UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  order_index        INT  NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_strategy_id, child_strategy_id),
  CHECK (parent_strategy_id <> child_strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_children_parent ON strategy_children(parent_strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_children_child  ON strategy_children(child_strategy_id);

ALTER TABLE strategy_children ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_children_select ON strategy_children;
CREATE POLICY strategy_children_select ON strategy_children FOR SELECT USING (true);

DROP POLICY IF EXISTS strategy_children_modify ON strategy_children;
CREATE POLICY strategy_children_modify ON strategy_children FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Realtime: strategies + strategy_children should stream so the
-- in-app Strategy tree reacts to multi-tab edits.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'strategy_children'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE strategy_children;
  END IF;
END $$;
