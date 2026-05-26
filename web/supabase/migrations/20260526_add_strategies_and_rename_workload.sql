-- Strategies: cross-Domain Object groupings (Linear Initiative-style).
-- A Strategy groups Objects from one or more Domains so a team can plan
-- and track an initiative whose scope spans organizational boundaries.

CREATE TABLE strategies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE strategy_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (strategy_id, object_id)
);

CREATE INDEX idx_strategy_objects_strategy ON strategy_objects(strategy_id);
CREATE INDEX idx_strategy_objects_object ON strategy_objects(object_id);

ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY strategies_select ON strategies FOR SELECT USING (true);
CREATE POLICY strategies_modify ON strategies FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY strategy_objects_select ON strategy_objects FOR SELECT USING (true);
CREATE POLICY strategy_objects_modify ON strategy_objects FOR ALL
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Rename 'workload' tab_type to 'resource' on existing tabs + the CHECK
-- constraint. The UI now calls the per-Worker capacity view "Resource".
UPDATE object_tabs SET tab_type = 'resource' WHERE tab_type = 'workload';

ALTER TABLE object_tabs DROP CONSTRAINT IF EXISTS object_tabs_tab_type_check;
ALTER TABLE object_tabs ADD CONSTRAINT object_tabs_tab_type_check
  CHECK (tab_type = ANY (ARRAY[
    'summary'::text,
    'elements'::text,
    'overview'::text,
    'gantt'::text,
    'calendar'::text,
    'workers'::text,
    'custom_view'::text,
    'board'::text,
    'note'::text,
    'resource'::text
  ]));
