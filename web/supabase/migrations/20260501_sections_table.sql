-- =============================================
-- Sections (first-class entity)
-- =============================================
-- Section was previously a free-text column on `elements.section` and
-- `objects.section`. That meant a section only "existed" while at least one
-- item referenced it — emptying a section made it disappear, which broke
-- the user's mental model ("section is a label that classifies items, the
-- label persists independently").
--
-- This migration promotes Section to a real table scoped to its parent
-- Object, with per-section `kind` ('element' | 'object' | null) so a single
-- section can be locked to host only Elements or only Objects.
--
-- Conceptually Section is still a Tag (a label), but it gets its own table
-- because:
--   • Tag values via custom_columns + custom_column_values can only attach
--     to elements (no object_id column), and Section needs to apply to BOTH
--     elements and child objects.
--   • Per-option `kind` metadata doesn't fit the generic SelectOption shape.
--
-- Per user direction we are NOT migrating existing data — the legacy
-- `elements.section` / `objects.section` columns are dropped outright.
-- ---------------------------------------------

-- 1. Drop legacy text section columns (data discarded by user direction)
ALTER TABLE public.elements DROP COLUMN IF EXISTS section;
ALTER TABLE public.objects  DROP COLUMN IF EXISTS section;

-- 2. Create sections table
CREATE TABLE IF NOT EXISTS public.sections (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id   uuid        NOT NULL REFERENCES public.objects(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  kind        text        CHECK (kind IN ('element', 'object')),  -- nullable = mixed/unknown
  order_index real        NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (object_id, name)
);

CREATE INDEX IF NOT EXISTS idx_sections_object_id ON public.sections(object_id);
CREATE INDEX IF NOT EXISTS idx_sections_order     ON public.sections(object_id, order_index);

-- 3. Add section_id FK to elements / objects
ALTER TABLE public.elements ADD COLUMN IF NOT EXISTS section_id uuid
  REFERENCES public.sections(id) ON DELETE SET NULL;
ALTER TABLE public.objects  ADD COLUMN IF NOT EXISTS section_id uuid
  REFERENCES public.sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_elements_section_id ON public.elements(section_id);
CREATE INDEX IF NOT EXISTS idx_objects_section_id  ON public.objects(section_id);

-- 4. updated_at auto-touch trigger (set_updated_at fn already exists from
--    earlier migrations)
DROP TRIGGER IF EXISTS sections_set_updated_at ON public.sections;
CREATE TRIGGER sections_set_updated_at
  BEFORE UPDATE ON public.sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. RLS — sections inherit access from their parent object. Match whatever
--    policy the objects table already exposes (currently permissive in this
--    project; tighten alongside objects when team membership lands).
ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sections_select" ON public.sections;
CREATE POLICY "sections_select" ON public.sections
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "sections_insert" ON public.sections;
CREATE POLICY "sections_insert" ON public.sections
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "sections_update" ON public.sections;
CREATE POLICY "sections_update" ON public.sections
  FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "sections_delete" ON public.sections;
CREATE POLICY "sections_delete" ON public.sections
  FOR DELETE USING (true);
