-- A review can record that a decision was reversed, but not by what. In the
-- exercise that found this, the second decision existed *because* the first was
-- overturned, and the board held the two as unrelated rows — the reason the
-- record is kept at all (reading back what was given up, and what happened
-- next) stopped at the point it became interesting.
--
-- `parent_intent_id` cannot carry it: that axis is what hangs a decision under
-- its Initiative's root Intent, and it is already spoken for. This is a second,
-- different edge between two decisions in the same Initiative, so it is its own
-- column rather than a reuse of that one.
--
-- ON DELETE SET NULL, not CASCADE: deleting the decision that replaced this one
-- must not delete the record of the one it replaced. The link is the weaker
-- fact, and it is the one that goes.
--
-- Nothing enforces that both ends sit in the same Initiative. A trigger could,
-- but the write path only ever offers siblings, and a constraint that has to
-- re-read the table to check a row is the shape that broke INSERT..RETURNING
-- here once already.
do $migration$
begin
  if to_regclass('public.intents') is null then
    raise notice 'decision supersede migration skipped: intents not present';
    return;
  end if;

  execute 'alter table public.intents add column if not exists superseded_by_intent_id uuid references public.intents(id) on delete set null';
  execute 'create index if not exists idx_intents_superseded_by on public.intents (superseded_by_intent_id) where superseded_by_intent_id is not null';

  -- A decision cannot replace itself: the link would read as a loop and the
  -- row would print "Reversed by <its own title>".
  if not exists (select 1 from pg_constraint where conrelid = 'public.intents'::regclass and conname = 'intents_superseded_by_not_self') then
    execute 'alter table public.intents add constraint intents_superseded_by_not_self check (superseded_by_intent_id is null or superseded_by_intent_id <> id)';
  end if;
end
$migration$;
