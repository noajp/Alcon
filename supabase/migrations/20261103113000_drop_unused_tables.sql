-- Drop tables nothing reads or writes (all empty), the notifications column
-- that pointed at one of them, and activity_spaces' vision columns, which the
-- visions table replaced.
do $$
begin
  if to_regclass('public.notifications') is not null then
    execute 'alter table public.notifications drop column if exists brief_id';
  end if;
  if to_regclass('public.activity_spaces') is not null then
    execute 'alter table public.activity_spaces
      drop column if exists vision,
      drop column if exists vision_horizon,
      drop column if exists vision_narrative,
      drop column if exists vision_conditions';
  end if;
end $$;

drop table if exists public.brief_comments;
drop table if exists public.briefs;
drop table if exists public.custom_view_placements;
drop table if exists public.custom_view_shapes;
drop table if exists public.custom_views;
drop table if exists public.time_entries;
drop function if exists public.roll_time_entry_to_element();
