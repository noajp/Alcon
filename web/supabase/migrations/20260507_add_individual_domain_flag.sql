-- "Individual" Domain flag — one fixed Domain per user.
-- The app auto-creates a row with is_individual=true on first login and
-- pins it to the top of the Execution sidebar; rename/delete are
-- disabled in the UI for individual rows.
ALTER TABLE public.domains
  ADD COLUMN IF NOT EXISTS is_individual boolean NOT NULL DEFAULT false;

-- At most one Individual Domain per user. Partial unique index lets
-- regular Domains share user_id freely.
CREATE UNIQUE INDEX IF NOT EXISTS domains_one_individual_per_user
  ON public.domains (user_id) WHERE is_individual = true;

COMMENT ON COLUMN public.domains.is_individual IS
  'True for the user-scoped fixed "Individual" Domain. One per user; UI prevents rename/delete.';
