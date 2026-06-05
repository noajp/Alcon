-- Objects gain a `due_date` so they can carry a target date like Elements do,
-- editable inline from the Object list's Due date column. Nullable; no backfill.
alter table public.objects add column if not exists due_date date;
