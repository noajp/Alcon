-- The role-update policy in the previous migration lets any owner promote or
-- demote another Space member, and el_QLT-022's Member admin UI checks
-- "would this leave the Space with zero owners?" against locally-fetched
-- React state before allowing a demote. That check is client-side only: two
-- co-owners each demoting the other (or a third owner) in close succession
-- can each pass their own stale ownerCount check and both UPDATEs land,
-- leaving the Space with zero owners and — since every INSERT/UPDATE/DELETE
-- on this table is itself owner-gated via is_activity_space_owner() — no
-- path back in without direct database access.
--
-- Closes it at the row level: reject any UPDATE that flips an owner's role
-- away from 'owner', or any DELETE of an owner row, if it would leave zero
-- owners behind in that activity_space_id. Two pieces make this actually
-- hold under concurrency and under cascades (both caught in review, both
-- verified against a rolled-back probe on the live project before shipping):
--
-- 1. `for update` locks the parent activity_spaces row before counting, so
--    two transactions racing to demote different owners of the SAME Space
--    serialize instead of each reading the other's not-yet-committed state
--    and both passing. A plain unlocked count(*) does not do this — both
--    owners look "still there" to each other's transaction.
-- 2. `activity_space_members.activity_space_id` is `on delete cascade`,
--    and Postgres fires row-level BEFORE DELETE triggers for cascaded
--    deletes too. Without an escape hatch, deleting a Space at all (which
--    cascades to delete its own last-owner row) or deleting a user who is
--    the sole owner of some Space (auth.users cascade) hits this guard and
--    fails — breaking Space deletion outright, not just the race it's
--    meant to close. The exists-checks below detect "the parent is already
--    gone" (true during a cascade, since the parent's row removal is part
--    of the same statement) and let those deletes through.
--
-- SECURITY DEFINER + pinned search_path: needed so the existence checks
-- above (activity_spaces, auth.users) don't depend on the acting role's own
-- grants/RLS — this function never returns queried data to the caller, it
-- only allows or raises, so bypassing RLS for its own reads doesn't expose
-- anything.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and the table lives outside the migrations folder (base
-- schema).

do $migration$
begin
  if to_regclass('public.activity_space_members') is null
     or to_regclass('public.activity_spaces') is null then
    raise notice 'activity_space_members last-owner guard skipped: base schema not present';
    return;
  end if;

  execute $sql$
    create or replace function public.guard_activity_space_last_owner()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, pg_catalog
    as $fn$
    declare
      remaining_owners int;
    begin
      if old.role <> 'owner' then
        return coalesce(new, old);
      end if;
      if tg_op = 'UPDATE' and new.role = 'owner' then
        return new;
      end if;

      if tg_op = 'DELETE' then
        if not exists (select 1 from public.activity_spaces where id = old.activity_space_id) then
          return old; -- cascaded from deleting the Space itself
        end if;
        if not exists (select 1 from auth.users where id = old.user_id) then
          return old; -- cascaded from deleting the user's account
        end if;
      end if;

      perform 1 from public.activity_spaces where id = old.activity_space_id for update;

      select count(*) into remaining_owners
      from public.activity_space_members
      where activity_space_id = old.activity_space_id
        and role = 'owner'
        and user_id <> old.user_id;

      if remaining_owners = 0 then
        raise exception 'A Space must keep at least one owner';
      end if;

      return coalesce(new, old);
    end;
    $fn$;
  $sql$;

  execute 'drop trigger if exists activity_space_members_guard_last_owner on public.activity_space_members';
  execute $sql$
    create trigger activity_space_members_guard_last_owner
      before update or delete on public.activity_space_members
      for each row
      execute function public.guard_activity_space_last_owner()
  $sql$;
end
$migration$;
