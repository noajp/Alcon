-- A note Section carries a color (a palette key, e.g. 'teal'): the mark
-- beside its name in the notebook. Null shows the default mark.
do $$
begin
  if to_regclass('public.notes') is null then
    raise notice 'notes.color skipped: notes not present'; return;
  end if;
  alter table public.notes add column if not exists color text;
end $$;
