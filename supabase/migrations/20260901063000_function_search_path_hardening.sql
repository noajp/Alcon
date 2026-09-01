-- Pin search_path on functions the Supabase linter flagged as
-- function_search_path_mutable, so an attacker-controlled role search_path
-- can't shadow the public-schema objects these functions reference unqualified.
--
-- Filename timestamp moved from 20260901060000 to 20260901063000 (content
-- otherwise unchanged): it collided with 20260901060000_introspect_one_hop.sql,
-- and Supabase's preview-branch replay inserts one schema_migrations row per
-- version before running a file's statements, so two files sharing a version
-- hit a duplicate-key error on the second one — every migration-touching PR's
-- Supabase Preview check was failing on this, not just the one that surfaced it.
do $$
begin
  if to_regprocedure('public.touch_intents_updated_at()') is not null then
    execute 'alter function public.touch_intents_updated_at() set search_path = public, pg_catalog';
  end if;

  if to_regprocedure('public.sync_element_approval_state()') is not null then
    execute 'alter function public.sync_element_approval_state() set search_path = public, pg_catalog';
  end if;

  if to_regprocedure('public.close_time_entry()') is not null then
    execute 'alter function public.close_time_entry() set search_path = public, pg_catalog';
  end if;

  if to_regprocedure('public.roll_time_entry_to_element()') is not null then
    execute 'alter function public.roll_time_entry_to_element() set search_path = public, pg_catalog';
  end if;

  if to_regprocedure('public.touch_voice_meeting_minutes_updated_at()') is not null then
    execute 'alter function public.touch_voice_meeting_minutes_updated_at() set search_path = public, pg_catalog';
  end if;

  if to_regprocedure('public.set_updated_at()') is not null then
    execute 'alter function public.set_updated_at() set search_path = public, pg_catalog';
  end if;

  if to_regprocedure('public.touch_strategies_updated_at()') is not null then
    execute 'alter function public.touch_strategies_updated_at() set search_path = public, pg_catalog';
  end if;
end $$;
