-- Objects gain a `start_date` (pair to the existing `due_date`) so they can
-- be drawn as Gantt bars in their own right — the Objects-tab Gantt switches
-- from "Elements grouped by Object" to "one bar per Object", and that needs a
-- real start point. Nullable; no backfill (existing Objects render as undated
-- in the Gantt until the user drags-to-schedule them).
--
-- Wrapped in the same "skip on preview replay" guard as add_due_date_to_objects:
-- on a fresh preview branch where the base schema lives outside this folder,
-- public.objects may not exist yet — make this a no-op instead of erroring.

do $$
begin
  if to_regclass('public.objects') is null then
    raise notice 'objects.start_date migration skipped: objects not present';
    return;
  end if;

  execute 'alter table public.objects add column if not exists start_date date';
end
$$;
