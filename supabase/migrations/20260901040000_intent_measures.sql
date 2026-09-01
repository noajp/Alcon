-- A Campaign could state what winning meant, and never say whether it won.
--
-- Every exercise run on this board wrote success conditions into the Campaign
-- description and then watched the board fail to read them. The third one made
-- it undeniable: a hospital preparing for accreditation, where the conditions
-- were five numbers set by somebody else — hand hygiene at or above 80%,
-- discharge summaries at or above 90%, mandatory training at 100%, falls
-- assessment at or above 95%, unclosed safety corrections at zero. No
-- interpretation, no negotiation. Week one produced measurements in the same
-- units: 71%, 82%, 88%. Three of the five already failing.
--
-- The board knew none of it. The target was prose in a description, the
-- reading was prose in a comment, and nothing subtracts one string from
-- another. So the thing missing was never a measurement system — the numbers
-- existed and a person was holding both of them. What was missing was a place
-- to put them next to each other.
--
-- Not Property. custom_columns has a number type and would have been the
-- cheaper answer, but its values attach to an Element, and a success condition
-- is not one Element's business: "mandatory training at 100%" spans several,
-- and "hand hygiene at 80%" is the output of one Element while the condition
-- belongs to the Campaign. A target hung on an Element breaks the moment the
-- two stop being one to one.
--
-- Not intent_resources either, whose declared_share / actual_share pair has
-- the right shape and the wrong subject: it is an allocation snapshot. Taking
-- it would repeat the slug mistake this schema just finished undoing.
--
-- So a measure is a third kind of row under the Campaign's root, beside the
-- decisions and the assumptions, in the same list and the same query. The
-- decision-only columns on this table are already null for assumptions; the
-- measure-only ones follow that pattern rather than inventing a second one.
--
-- direction is stored because "at least" and "at most" are not derivable: zero
-- unclosed corrections and one hundred percent trained are both満点, and only
-- the condition itself says which way its number is supposed to move.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `intents` is created outside it.

do $migration$
begin
  if to_regclass('public.intents') is null then
    raise notice 'intent measures skipped: intents not present';
    return;
  end if;

  execute 'alter table public.intents drop constraint if exists intents_kind_check';
  execute $ddl$
    alter table public.intents
      add constraint intents_kind_check
      check (kind in ('decision', 'assumption', 'measure', 'master'))
  $ddl$;

  -- The number the condition names, and the number somebody last read. Both
  -- nullable: a condition written before anyone measured it is still worth
  -- having on the board, and saying so is the point of el_STR-012.
  execute 'alter table public.intents add column if not exists target_value numeric';
  execute 'alter table public.intents add column if not exists actual_value numeric';

  -- Free text because the units are the operator's, not this schema's — per
  -- cent, cases, households a day. A closed list would be wrong within a week.
  execute 'alter table public.intents add column if not exists unit text';

  -- When the reading was taken. A measure whose actual is six weeks old is a
  -- different thing from one read this morning, and the row should be able to
  -- say which without anyone remembering.
  execute 'alter table public.intents add column if not exists measured_at timestamptz';

  execute 'alter table public.intents drop constraint if exists intents_direction_check';
  execute $ddl$
    alter table public.intents
      add column if not exists direction text
  $ddl$;
  execute $ddl$
    alter table public.intents
      add constraint intents_direction_check
      check (direction is null or direction in ('at_least', 'at_most'))
  $ddl$;
end $migration$;
