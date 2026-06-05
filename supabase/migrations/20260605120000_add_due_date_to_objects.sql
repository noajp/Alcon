-- Objects gain a `due_date` so they can carry a target date like Elements do,
-- editable inline from the Object list's Due date column. Nullable; no backfill.
--
-- Wrapped in the same "skip on preview replay" guard as the element_progress
-- migration: if public.objects hasn't been created yet (fresh preview branch
-- replaying the migrations folder, where the base schema lives outside the
-- migrations history), this becomes a no-op instead of erroring with
-- "relation public.objects does not exist".

do $$
begin
  if to_regclass('public.objects') is null then
    raise notice 'objects.due_date migration skipped: objects not present';
    return;
  end if;

  execute 'alter table public.objects add column if not exists due_date date';
end
$$;
