-- Remove the "Individual Domain" pattern and replace it with explicit
-- per-user Element ownership.
--
-- Before: each user got a fixed Domain row (is_individual=true) that
-- contained their personal Objects/Elements. The sidebar pinned it as
-- "Individual Domain".
--
-- After: personal Elements live at the root (object_id IS NULL) and are
-- tagged with owner_id. The dedicated "My Elements" view filters by that
-- column; Domain-scoped views filter it out so personal items don't leak
-- into shared lists.

-- 1. Add owner_id to elements. Nullable: a non-personal Element under a
--    Domain Object has owner_id = NULL.
ALTER TABLE elements ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id);

-- 2. Link the existing seed "中野貴慶" worker to the Individual Domain's
--    owning user so the migrated Elements have a valid assignee. Skipped
--    when the worker is already linked, or when no Individual Domains
--    remain on a fresh database.
UPDATE workers
SET user_id = (SELECT d.user_id FROM domains d WHERE d.is_individual = true LIMIT 1)
WHERE id = 'a1000001-0000-0000-0000-000000000001'
  AND user_id IS NULL
  AND EXISTS (SELECT 1 FROM domains WHERE is_individual = true);

-- 3. Auto-assign each user's worker to every Element under their
--    Individual Domain so "My Elements" (filter: assignee includes me)
--    finds them after migration.
INSERT INTO element_assignees (id, element_id, worker_id, role, assigned_at)
SELECT gen_random_uuid(), e.id, w.id, 'assignee', NOW()
FROM domains d
JOIN workers w ON w.user_id = d.user_id
JOIN objects o ON o.domain_id = d.id
JOIN elements e ON e.object_id = o.id
WHERE d.is_individual = true
ON CONFLICT DO NOTHING;

-- 4. Stamp owner_id on those Elements.
UPDATE elements
SET owner_id = (
  SELECT d.user_id
  FROM domains d
  JOIN objects o ON o.domain_id = d.id
  WHERE d.is_individual = true AND o.id = elements.object_id
  LIMIT 1
)
WHERE object_id IN (
  SELECT o.id FROM objects o
  JOIN domains d ON d.id = o.domain_id
  WHERE d.is_individual = true
);

-- 5. Detach the Elements from their Objects (the Objects are about to be
--    deleted). After this they read as personal/orphaned at the data
--    level, found only via owner_id / assignee.
UPDATE elements
SET object_id = NULL
WHERE object_id IN (
  SELECT o.id FROM objects o
  JOIN domains d ON d.id = o.domain_id
  WHERE d.is_individual = true
);

-- 6. Clear element_objects junction entries that pointed at the
--    Individual-Domain Objects.
DELETE FROM element_objects
WHERE object_id IN (
  SELECT o.id FROM objects o
  JOIN domains d ON d.id = o.domain_id
  WHERE d.is_individual = true
);

-- 7. Delete the Individual-Domain Objects.
DELETE FROM objects WHERE domain_id IN (SELECT id FROM domains WHERE is_individual = true);

-- 8. Delete the Individual Domain rows themselves.
DELETE FROM domains WHERE is_individual = true;

-- 9. Drop the partial unique index that enforced one-Individual-per-user.
DROP INDEX IF EXISTS domains_one_individual_per_user;

-- 10. Drop the is_individual column. Done last so the earlier steps could
--     still reference it.
ALTER TABLE domains DROP COLUMN IF EXISTS is_individual;
