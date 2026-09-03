-- Campaign visibility, on the boundary model, without a schema change.
--
-- el_STR-008's original shape (an `activity_space_id` column on `strategies`,
-- backfilled from context) doesn't fit the actual data: `開発ロードマップ` and
-- `Retry Strategy` each have linked Objects spanning two different
-- ActivitySpaces at once (Flixion and Action), and `全社ポートフォリオ` has no
-- linked Objects at all (a pure strategy_children container). A single column
-- would have to pick one Space for the cross-Space rows and silently drop the
-- other — exactly the kind of information loss the rest of this codebase
-- avoids by using a junction (`object_domains`) wherever an Execution-layer
-- row can genuinely multi-home.
--
-- Derived instead, the same way `user_can_see_object` already is: a Campaign
-- is visible if you created it, or if you can see any Object it covers
-- (`user_can_see_object`, which already walks both the Object's primary
-- Domain and its `object_domains` multi-homes). No backfill, no new column,
-- and it never goes stale — linking or unlinking an Object changes visibility
-- immediately because there is nothing cached to fall out of sync.
--
-- Scope is SELECT only. Broadening who may edit or delete someone else's
-- Campaign is a materially bigger question this migration does not answer —
-- the existing owner-scoped write policies (from 20260830000007) are
-- untouched. A pure hierarchy container with no linked Objects (like
-- `全社ポートフォリオ`) stays visible only to its creator; making it inherit
-- visibility from its `strategy_children` is a separate follow-up, not
-- assumed here.
--
-- Purely additive: every policy below is a new PERMISSIVE policy layered on
-- top of whatever already exists, never a DROP/REPLACE of one. `strategies`'
-- own select/update/delete policies predate the migrations folder (created
-- directly on the hosted project — the same reason 20260830000007 could only
-- describe them, not show them), so this migration does not depend on
-- knowing their exact current text: PostgreSQL always ORs PERMISSIVE
-- policies together, so adding one only ever widens access, regardless of
-- what else is already in place.
--
-- Two landmines avoided, both found by testing this against a real RLS
-- simulation rather than trusting the design on paper:
--
-- 1. `user_can_see_strategy` re-queries `strategies` internally, and
--    boundary_rls.sql already documented why a self-querying helper breaks
--    `INSERT ... RETURNING` when used as that same table's own SELECT policy
--    (the policy evaluates against a pre-insert snapshot in which the new row
--    doesn't exist yet). So `strategies`' own new policy below does not call
--    that helper; `user_can_see_strategy` is for every OTHER table
--    (strategy_children, and later intents/intent_bindings) where that
--    hazard doesn't apply.
--
-- 2. The first version of `strategies`' own policy instead wrote out a raw
--    subquery against `strategy_objects` — and hit a second, worse landmine:
--    `strategy_objects` already carries an owner-scoped policy that queries
--    `strategies` right back (`exists (select 1 from strategies s where
--    s.id = strategy_id and s.created_by = auth.uid())`, predating this
--    migration). A plain subquery runs under the caller's own row security,
--    so `strategies` → `strategy_objects` → `strategies` is a real cycle:
--    "infinite recursion detected in policy for relation strategies" on
--    every query, including a bare owner SELECT. `strategy_object_visible`
--    below exists only to break that cycle: SECURITY DEFINER makes its
--    internal read of `strategy_objects` bypass that table's RLS entirely
--    (it runs as the function's owner, which owns every table here), so the
--    loop never has a second leg to close.
--
-- intents / intent_bindings are a known mirror gap (too strict, not too
-- loose: currently owner-only, so a Space member who can see the Campaign
-- still can't read its decisions) surfaced by the KESTREL exercise. Left for
-- a separate Element — this migration's acceptance criteria was strategies /
-- strategy_objects / strategy_children only.
--
-- One more table widens as a direct consequence, on purpose: strategy_comments
-- (20260830000005) already derives its own SELECT policy from a bare
-- `exists (select 1 from strategies s where s.id = strategy_id)`, evaluated
-- under the caller's own RLS on strategies rather than a SECURITY DEFINER
-- helper — that migration's own comment says this was deliberate, precisely
-- so a later change to strategies' visibility (this one) would not need a
-- second edit here. So a Campaign's comment thread becomes exactly as visible
-- as the Campaign itself, automatically. This migration touches nothing in
-- strategy_comments.sql; noting it here so the propagation reads as reviewed
-- rather than accidental.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and `strategies` / `user_can_see_object` are created
-- outside it.

do $migration$
begin
  if to_regclass('public.strategies') is null
     or to_regclass('public.strategy_objects') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null then
    raise notice 'strategy boundary visibility skipped: base schema not present';
    return;
  end if;

  -- ── helper: breaks the strategies <-> strategy_objects RLS cycle ───────────
  -- Defined first because user_can_see_strategy below calls it.
  execute $fn$
    create or replace function public.strategy_object_visible(_strategy_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select exists (
        select 1 from public.strategy_objects so
        where so.strategy_id = _strategy_id
          and public.user_can_see_object(so.object_id)
      );
    $body$;
  $fn$;

  -- ── helper: general-purpose, safe on every table except strategies itself ──
  -- Delegates the object-linked half to strategy_object_visible instead of
  -- repeating its body: both are SECURITY DEFINER and strategy_object_visible
  -- never touches strategies, so calling it from here reopens neither the
  -- RETURNING landmine nor the RLS-recursion one below — it's a plain reuse.
  execute $fn$
    create or replace function public.user_can_see_strategy(_strategy_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = public
    as $body$
      select
        exists (
          select 1 from public.strategies s
          where s.id = _strategy_id and s.created_by = auth.uid()
        )
        or public.strategy_object_visible(_strategy_id);
    $body$;
  $fn$;

  -- ── strategies: additive SELECT, row's own columns + the helper above ──────
  -- (RETURNING-safe: neither branch re-queries strategies under caller RLS)
  execute 'drop policy if exists strategies_select_via_boundary on public.strategies';
  execute $sql$
    create policy strategies_select_via_boundary on public.strategies
      for select using (
        created_by = auth.uid()
        or public.strategy_object_visible(id)
      )
  $sql$;

  -- ── strategy_objects: additive SELECT via the linked Object ────────────────
  execute 'drop policy if exists strategy_objects_select_via_boundary on public.strategy_objects';
  execute $sql$
    create policy strategy_objects_select_via_boundary on public.strategy_objects
      for select using (public.user_can_see_object(object_id))
  $sql$;

  -- ── strategy_children: additive SELECT, requires BOTH ends visible ─────────
  -- AND, not OR: a link to a Campaign you can't otherwise see would leak that
  -- Campaign's id and its existence as a parent/child even though its own row
  -- stays hidden — exactly the case `全社ポートフォリオ` (creator-only, no
  -- linked Objects) is supposed to be protected from. `element_objects` in
  -- boundary_rls.sql requires both ends visible for the same reason (a
  -- junction shouldn't reveal more than either endpoint's own policy already
  -- allows), so this matches established precedent rather than introducing a
  -- new rule.
  if to_regclass('public.strategy_children') is not null then
    execute 'drop policy if exists strategy_children_select_via_boundary on public.strategy_children';
    execute $sql$
      create policy strategy_children_select_via_boundary on public.strategy_children
        for select using (
          public.user_can_see_strategy(parent_strategy_id)
          and public.user_can_see_strategy(child_strategy_id)
        )
    $sql$;
  end if;
end
$migration$;
