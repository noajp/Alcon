-- The TS types, StatusPicker, and createElement all already treat
-- 'backlog' and 'cancelled' as valid Element statuses, but the elements
-- status CHECK constraint never included them — so picking Backlog or
-- Cancelled (e.g. from StatusPicker, or → Element 化 on a note bullet)
-- threw elements_status_check. Widen the allowlist to match the code.
-- Purely additive: every existing row's status is in the old subset,
-- so all rows still satisfy the new constraint.
ALTER TABLE elements DROP CONSTRAINT IF EXISTS elements_status_check;
ALTER TABLE elements ADD CONSTRAINT elements_status_check
  CHECK (status = ANY (ARRAY['backlog'::text, 'todo'::text, 'in_progress'::text, 'review'::text, 'done'::text, 'blocked'::text, 'cancelled'::text]));
