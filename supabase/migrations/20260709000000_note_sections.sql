-- Note sections — a middle tier in the Note tree: folder → section → file.
-- Sections render as OneNote-style tabs at the top of the Note surface.
-- Files may still live directly under a folder (pre-section data and the
-- default "no sections yet" state), so the parent rule keeps that legal.
--
-- Guarded: preview branches replay this folder on an EMPTY database (the
-- base schema lives outside it), so bail out when `notes` doesn't exist.
DO $$
BEGIN
  IF to_regclass('public.notes') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_type_check;
  ALTER TABLE public.notes ADD CONSTRAINT notes_type_check
    CHECK (type = ANY (ARRAY['folder'::text, 'section'::text, 'file'::text]));

  ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_parent_rules;
  ALTER TABLE public.notes ADD CONSTRAINT notes_parent_rules
    CHECK (
      ((type = 'folder'::text) AND (parent_id IS NULL))
      OR ((type = 'section'::text) AND (parent_id IS NOT NULL))
      OR ((type = 'file'::text) AND (parent_id IS NOT NULL))
    );
END $$;
