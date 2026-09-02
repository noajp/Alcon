-- The role-update policy in the previous migration lets any owner promote or
-- demote another Space member, and el_QLT-022's Member admin UI checks
-- "would this leave the Space with zero owners?" against locally-fetched
-- React state before allowing a demote. That check is client-side only: two
-- co-owners each demoting the other (or a third owner) in quick succession
-- can each pass their own stale ownerCount check and both UPDATEs land,
-- leaving the Space with zero owners and — since every INSERT/UPDATE/DELETE
-- on this table is itself owner-gated via is_activity_space_owner() — no
-- path back in without direct database access.
--
-- This closes it at the row level, which is atomic regardless of how many
-- clients race: reject any UPDATE that flips an owner's role away from
-- 'owner', or any DELETE of an owner row, if it would leave zero owners
-- behind in that activity_space_id. Runs BEFORE UPDATE OR DELETE so it sees
-- the pre-change row count and can raise before the change commits.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and the table lives outside the migrations folder (base
-- schema).

do $migration$
begin
  if to_regclass('public.activity_space_members') is null then
    raise notice 'activity_space_members last-owner guard skipped: base schema not present';
    return;
  end if;

  execute $sql$
    create or replace function public.guard_activity_space_last_owner()
    returns trigger
    language plpgsql
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
