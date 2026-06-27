-- Add logo column to activity_spaces.
-- Stores either an emoji (e.g. "🏢") or a storage URL for uploaded images.
DO $$
BEGIN
  IF to_regclass('public.activity_spaces') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'activity_spaces'
         AND column_name  = 'logo'
     )
  THEN
    ALTER TABLE public.activity_spaces ADD COLUMN logo text;
  END IF;
END $$;
