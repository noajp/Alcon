-- Add parent_system_id for nested systems
ALTER TABLE systems ADD COLUMN IF NOT EXISTS parent_system_id uuid REFERENCES systems(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_systems_parent_system_id ON systems(parent_system_id);
