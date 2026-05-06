-- "Individual" Domain flag — one fixed personal Domain per user.
-- The app auto-creates a row with is_personal=true on first login and
-- pins it to the top of the Execution sidebar; rename/delete are
-- disabled in the UI for personal rows.
ALTER TABLE public.domains
  ADD COLUMN IF NOT EXISTS is_personal boolean NOT NULL DEFAULT false;

-- At most one personal Domain per user. Partial unique index lets
-- regular Domains share user_id freely.
CREATE UNIQUE INDEX IF NOT EXISTS domains_one_personal_per_user
  ON public.domains (user_id) WHERE is_personal = true;

COMMENT ON COLUMN public.domains.is_personal IS
  'True for the user-scoped personal "Individual" Domain. One per user; UI prevents rename/delete.';
