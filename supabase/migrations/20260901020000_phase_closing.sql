-- A Phase could end, but never be finished.
--
-- Phases carry a name and two dates and nothing else, so a time box has no way
-- to say it closed. Both tabletop exercises walked into this from different
-- ends. A relief operation finished six of seven tasks in its first phase and
-- moved on; a company reached the end of a quarter with four of seven still
-- open, after its CEO had deliberately slid the deadline three weeks. In both
-- cases the phase simply became the past when its end_date went by, and the
-- board could not tell "we got what we came for" from "we ran out of time" —
-- which is the whole of what a stage boundary is for.
--
-- The second half is where the unfinished work goes. Nothing carried it: an
-- Element stayed pointed at the phase that had ended, showing as overdue
-- against a date the plan itself had already moved, and the only way to move
-- it on was to rewrite phase_id by hand. Linear's cycles roll their leftovers
-- forward; a Phase had no equivalent, and no memory that anything had been
-- rolled at all.
--
-- So: a status that has to be set rather than arrived at, a record of when and
-- why it was set, and a count on the Element of how many times it has been
-- pushed. Carrying forward stays an act somebody performs — the value of a
-- time box is that it makes "we did not finish" visible once, and a box that
-- quietly empties itself into the next one destroys the instrument. The count
-- is what survives the carry: an Element on its third phase is saying
-- something an Element on its first is not.
--
-- Deliberately not added: completion criteria written in advance. Neither
-- exercise wanted one. What both wanted was to tell an achieved close from an
-- expired one, which is the status plus the note, and a column nobody asked
-- for is a guess about a workflow nobody has run yet.
--
-- Also not added: a link from the closing to the decision that caused it. In
-- the company exercise the four unfinished items were unfinished *as planned*,
-- because a recorded decision had moved the date — and that decision exists on
-- the board now. Binding a Phase to it needs intent_bindings.target_type to
-- accept 'phase', which is el_STR-017. Until then the note carries it as
-- prose, and the note says so.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `phases` / `elements` are created outside it.

do $migration$
begin
  if to_regclass('public.phases') is null or to_regclass('public.elements') is null then
    raise notice 'phase closing skipped: phases or elements not present';
    return;
  end if;

  -- `planned` is the default because a Phase that nobody has started is the
  -- honest reading of a row that has only ever been created. Moving to
  -- `active` and to `complete` are both acts.
  execute $ddl$
    alter table public.phases
      add column if not exists status text not null default 'planned'
  $ddl$;

  execute 'alter table public.phases drop constraint if exists phases_status_check';
  execute $ddl$
    alter table public.phases
      add constraint phases_status_check
      check (status in ('planned', 'active', 'complete'))
  $ddl$;

  -- When it was closed, and what closing meant. The note is where "we got what
  -- we came for" and "we ran out of time" become distinguishable, and it is
  -- prose on purpose: the difference is a judgement, and the exercises that
  -- produced this both expressed it in a sentence rather than a flag.
  execute 'alter table public.phases add column if not exists closed_at timestamptz';
  execute 'alter table public.phases add column if not exists closing_note text';

  -- A Phase past its end_date that is not complete is the "ran out of time"
  -- case, and it is derived rather than stored — end_date and status already
  -- say it, and a third column would be able to disagree with them.

  -- How many times this Element has been pushed into a later Phase. Zero for
  -- everything that exists today, which is the truthful reading: nothing has
  -- been carried yet because carrying was not possible.
  execute $ddl$
    alter table public.elements
      add column if not exists carried_over_count integer not null default 0
  $ddl$;

  execute 'alter table public.elements drop constraint if exists elements_carried_over_count_check';
  execute $ddl$
    alter table public.elements
      add constraint elements_carried_over_count_check
      check (carried_over_count >= 0)
  $ddl$;

  -- Closing reads "which Phases in this Domain are not complete", and the
  -- Phase list is already ordered by order_index, so the index carries both.
  execute 'create index if not exists phases_domain_status_idx
           on public.phases (domain_id, status, order_index)';

  -- No RLS block: both tables already carry their own policies, and neither
  -- new column changes who may see a row.
end $migration$;
