-- =============================================
-- Alcon New Schema Migration
-- From: departments + teams (container model)
-- To: organization_units (folder/execute) + work graph model
-- =============================================

-- 1. Create new organization_units table
CREATE TABLE IF NOT EXISTS organization_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES organization_units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('folder', 'execute')),
  color TEXT,
  description TEXT,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create workers table (unified human + AI)
CREATE TABLE IF NOT EXISTS workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_unit_id UUID REFERENCES organization_units(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('human', 'ai_agent')),
  name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  avatar_url TEXT,
  ai_model TEXT,
  ai_config JSONB,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'busy')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create goals table
CREATE TABLE IF NOT EXISTS goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_date DATE,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create project_links table (multi-context for projects)
CREATE TABLE IF NOT EXISTS project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('unit', 'goal', 'portfolio')),
  target_id UUID NOT NULL,
  relationship TEXT CHECK (relationship IN ('contributes', 'depends_on', 'supports')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Create task_links table (multi-context for tasks)
CREATE TABLE IF NOT EXISTS task_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK (target_type IN ('unit', 'worker', 'goal')),
  target_id UUID NOT NULL,
  role TEXT CHECK (role IN ('contributor', 'reviewer', 'blocker', 'watcher')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create task_dependencies table
CREATE TABLE IF NOT EXISTS task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  dependency_type TEXT CHECK (dependency_type IN ('blocks', 'requires', 'related')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(task_id, depends_on_task_id)
);

-- 7. Add owner_unit_id to projects (for new structure)
ALTER TABLE projects
ADD COLUMN IF NOT EXISTS owner_unit_id UUID REFERENCES organization_units(id) ON DELETE SET NULL;

-- 8. Update tasks to reference workers instead of members
ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS worker_id UUID REFERENCES workers(id) ON DELETE SET NULL;

-- =============================================
-- Migrate existing data
-- =============================================

-- 9. Migrate departments to organization_units (as folder type)
INSERT INTO organization_units (id, company_id, parent_id, name, type, color, description, created_at, updated_at)
SELECT
  id,
  company_id,
  NULL,
  name,
  'folder',
  color,
  description,
  created_at,
  updated_at
FROM departments
ON CONFLICT (id) DO NOTHING;

-- 10. Migrate teams to organization_units (as execute type)
INSERT INTO organization_units (id, company_id, parent_id, name, type, color, description, created_at, updated_at)
SELECT
  t.id,
  d.company_id,
  t.department_id,  -- parent is the department
  t.name,
  'execute',
  NULL,
  t.description,
  t.created_at,
  t.updated_at
FROM teams t
JOIN departments d ON t.department_id = d.id
ON CONFLICT (id) DO NOTHING;

-- 11. Migrate members to workers (as human type)
INSERT INTO workers (id, organization_unit_id, type, name, role, email, avatar_url, status, created_at, updated_at)
SELECT
  id,
  team_id,
  'human',
  name,
  role,
  email,
  avatar_url,
  'active',
  created_at,
  updated_at
FROM members
ON CONFLICT (id) DO NOTHING;

-- 12. Update projects to use owner_unit_id
UPDATE projects
SET owner_unit_id = team_id
WHERE team_id IS NOT NULL AND owner_unit_id IS NULL;

-- 13. Copy assignee_id to worker_id in tasks
UPDATE tasks
SET worker_id = assignee_id
WHERE assignee_id IS NOT NULL AND worker_id IS NULL;

-- =============================================
-- Create indexes for performance
-- =============================================

CREATE INDEX IF NOT EXISTS idx_org_units_parent ON organization_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_org_units_company ON organization_units(company_id);
CREATE INDEX IF NOT EXISTS idx_org_units_type ON organization_units(type);
CREATE INDEX IF NOT EXISTS idx_workers_unit ON workers(organization_unit_id);
CREATE INDEX IF NOT EXISTS idx_workers_type ON workers(type);
CREATE INDEX IF NOT EXISTS idx_project_links_project ON project_links(project_id);
CREATE INDEX IF NOT EXISTS idx_task_links_task ON task_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends ON task_dependencies(depends_on_task_id);

-- =============================================
-- Enable RLS on new tables
-- =============================================

ALTER TABLE organization_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

-- Allow public read for now (adjust as needed)
CREATE POLICY "Allow public read" ON organization_units FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON organization_units FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON organization_units FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON organization_units FOR DELETE USING (true);

CREATE POLICY "Allow public read" ON workers FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON workers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON workers FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON workers FOR DELETE USING (true);

CREATE POLICY "Allow public read" ON goals FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON goals FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON goals FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON goals FOR DELETE USING (true);

CREATE POLICY "Allow public read" ON project_links FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON project_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON project_links FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON project_links FOR DELETE USING (true);

CREATE POLICY "Allow public read" ON task_links FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON task_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON task_links FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON task_links FOR DELETE USING (true);

CREATE POLICY "Allow public read" ON task_dependencies FOR SELECT USING (true);
CREATE POLICY "Allow public insert" ON task_dependencies FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update" ON task_dependencies FOR UPDATE USING (true);
CREATE POLICY "Allow public delete" ON task_dependencies FOR DELETE USING (true);
