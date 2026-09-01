-- Four compromises the Intent layer took because a CHECK could not be changed.
--
-- The Campaign now carries two kinds of row under its root Intent — decisions
-- and assumptions — and `intents` has no column saying which. `slug` was the
-- one that was free, so it got taken: nullable, no unique index, null on every
-- decision written so far. It works, and it costs the column its documented
-- job of naming a card for cross-references. A kind belongs in a column that
-- says kind.
--
-- The other three are the binding table refusing targets that the exercises
-- kept reaching for.
--
--   phase   — a decision to slide a quarter is the largest thing a Campaign
--             does, and the Phase it moved cannot point back at it. "Why is
--             this running into October" has an answer that the thing it
--             happened to cannot reach.
--
--   worker  — a Campaign wrote down "the one person who has been through a
--             survey before is our single point of failure", and then that
--             person was admitted to hospital for three weeks. Both facts are
--             on the board, in two places, unconnected: an absence in
--             worker_availability and an assumption in intents. An assumption
--             whose subject is a *person* cannot be bound to anything, because
--             the target list stops at Element — even though a Worker is, in
--             this product's own words, the central means Strategy employs.
--
--   reschedules — none of the five relationships says "this decision moved
--             this thing's dates". `delivers` was used instead: true, and
--             broader than what happened.
--
-- All four are CHECK constraints, which is why they are one migration rather
-- than four. Existing rows migrate: every intent carrying the assumption slug
-- becomes kind='assumption' and gets its slug back.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `intents` / `intent_bindings` are created outside it.

do $migration$
begin
  if to_regclass('public.intents') is null or to_regclass('public.intent_bindings') is null then
    raise notice 'intent kind/targets skipped: intents or intent_bindings not present';
    return;
  end if;

  -- ── intents.kind ───────────────────────────────────────────────────────────
  -- `decision` is the default because it is what the surface was built for
  -- first, and because every row that predates this column is one.
  execute $ddl$
    alter table public.intents
      add column if not exists kind text not null default 'decision'
  $ddl$;

  execute 'alter table public.intents drop constraint if exists intents_kind_check';
  execute $ddl$
    alter table public.intents
      add constraint intents_kind_check
      check (kind in ('decision', 'assumption', 'master'))
  $ddl$;

  -- The rows already written. A Campaign's root Intent is the spine rather
  -- than a decision — it is never listed as one — so it takes its own kind,
  -- and the assumptions give back the slug they borrowed.
  execute $ddl$
    update public.intents
       set kind = 'assumption', slug = null
     where slug = 'assumption'
  $ddl$;
  execute $ddl$
    update public.intents
       set kind = 'master'
     where parent_intent_id is null and kind = 'decision'
  $ddl$;

  execute 'create index if not exists intents_strategy_kind_idx
           on public.intents (strategy_id, kind, order_index)';

  -- ── intent_bindings.target_type ────────────────────────────────────────────
  -- No FK is added with these. The table already points at three tables through
  -- one untyped column and resolves the target in the reader; adding one for
  -- two of the five would make the column half-enforced, which is harder to
  -- reason about than not enforced at all.
  execute 'alter table public.intent_bindings drop constraint if exists intent_bindings_target_type_check';
  execute $ddl$
    alter table public.intent_bindings
      add constraint intent_bindings_target_type_check
      check (target_type in ('domain', 'object', 'element', 'phase', 'worker'))
  $ddl$;

  -- ── intent_bindings.relationship_type ──────────────────────────────────────
  execute 'alter table public.intent_bindings drop constraint if exists intent_bindings_relationship_type_check';
  execute $ddl$
    alter table public.intent_bindings
      add constraint intent_bindings_relationship_type_check
      check (relationship_type in
        ('evidences', 'measures', 'tests', 'delivers', 'competes_with', 'reschedules'))
  $ddl$;
end $migration$;
