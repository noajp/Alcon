-- A Strategy can pin one Note (its Document), as an Element and an Object do:
-- shown in place under its description.
do $$
begin
  if to_regclass('public.strategies') is null or to_regclass('public.notes') is null then
    raise notice 'strategies.note_id skipped: strategies or notes not present'; return;
  end if;
  alter table public.strategies add column if not exists note_id uuid references public.notes(id) on delete set null;
end $$;
