-- Campaigns were readable and writable by everyone with an account.
--
-- `strategies` already had the right policies — select, update and delete all
-- scoped to `created_by = auth.uid()`. Alongside them sat `strategies_modify`,
-- PERMISSIVE and FOR ALL, granting `auth.uid() IS NOT NULL`. PostgreSQL ORs
-- permissive policies together, and FOR ALL covers SELECT, so that one policy
-- silently made the other three unreachable. Every signed-in account could
-- read, edit and delete every Campaign in the database.
--
-- `strategy_objects` was worse: its select policy was the literal `true`.
--
-- This is not a hypothetical exposure. There are four accounts, and all four
-- Campaigns belong to one of them. It also became sharply more serious in the
-- same hour it was found: Campaigns just gained comment threads
-- (20260830000005), whose select policy deliberately derives from this one —
-- so the directives given to the self-build loop, and the reasoning behind
-- them, inherited the hole the moment they had somewhere to be written.
--
-- The fix is subtraction. The owner-scoped policies were correct all along;
-- the FOR ALL ones are removed so they can take effect, and the junctions are
-- derived from the Campaign the same way `strategy_children` already was.
-- Nothing here decides the wider question of putting Campaigns on the Space /
-- Domain boundary model, which is what el_STR-008 is really about — that needs
-- an `activity_space_id` and a membership rule, and it is a design decision.
-- Closing a hole is not.
--
-- Safe to apply as-is: all four rows have a non-null `created_by`, so nothing
-- becomes invisible to its owner. A Campaign with a null owner would vanish
-- from every account, which is why that was checked first rather than assumed.

do $migration$
begin
  if to_regclass('public.strategies') is null then
    raise notice 'strategies RLS fix skipped: strategies not present (preview replay?)';
    return;
  end if;

  -- ── strategies ─────────────────────────────────────────────────────────────
  -- Drop the override. select / insert / update / delete already exist and are
  -- owner-scoped; with this gone they finally apply.
  execute 'drop policy if exists strategies_modify on public.strategies';

  -- ── strategy_objects ───────────────────────────────────────────────────────
  -- Which Objects a Campaign covers is part of the Campaign. Deriving the
  -- policy from `strategies` rather than restating a rule means this tightens
  -- on its own when Campaigns move onto the boundary model — the same reason
  -- strategy_comments was written that way.
  if to_regclass('public.strategy_objects') is not null then
    execute 'drop policy if exists strategy_objects_select on public.strategy_objects';
    execute 'drop policy if exists strategy_objects_modify on public.strategy_objects';
    execute 'drop policy if exists strategy_objects_insert on public.strategy_objects';
    execute 'drop policy if exists strategy_objects_delete on public.strategy_objects';

    execute $sql$
      create policy strategy_objects_select on public.strategy_objects
        for select using (
          exists (select 1 from public.strategies s
                  where s.id = strategy_id and s.created_by = auth.uid())
        )
    $sql$;

    execute $sql$
      create policy strategy_objects_insert on public.strategy_objects
        for insert with check (
          exists (select 1 from public.strategies s
                  where s.id = strategy_id and s.created_by = auth.uid())
        )
    $sql$;

    execute $sql$
      create policy strategy_objects_delete on public.strategy_objects
        for delete using (
          exists (select 1 from public.strategies s
                  where s.id = strategy_id and s.created_by = auth.uid())
        )
    $sql$;
    -- No update policy on purpose: the row is a pair of foreign keys. Changing
    -- either one is a different link, which is a delete and an insert.
  end if;
end
$migration$;
