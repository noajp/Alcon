-- Direct per-Element progress (0-100). Used by the In Progress row in the
-- status picker. Takes priority over the subelement-derived fallback in
-- getElementProgress.
--
-- Wrapped in the same "skip on preview replay" guard as the agent_runs
-- migration: if public.elements hasn't been created yet (fresh preview
-- branch replaying the migrations folder), this becomes a no-op.

do $$
begin
  if to_regclass('public.elements') is null then
    raise notice 'elements.progress migration skipped: elements not present';
    return;
  end if;

  execute 'alter table public.elements add column if not exists progress smallint';

  if not exists (
    select 1 from pg_constraint
    where conname = 'elements_progress_range'
      and conrelid = 'public.elements'::regclass
  ) then
    execute 'alter table public.elements add constraint elements_progress_range
             check (progress is null or (progress >= 0 and progress <= 100))';
  end if;
end
$$;
