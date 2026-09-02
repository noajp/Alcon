-- CRITICAL: activity_space_members' INSERT policy admitted an unconditional
-- `user_id = auth.uid()` branch, alongside the owner-gated branch used by
-- invites. That branch has no tie to the target Space at all — any
-- authenticated user who knows (or enumerates) an activity_space_id can
-- INSERT themselves into it with an arbitrary role, including 'owner'. Found
-- while reviewing el_QLT-022's new UPDATE policy on this table, which turns
-- that takeover into a full lockout: a self-inserted 'owner' can now also
-- demote the legitimate owners.
--
-- The one legitimate use of the self-insert branch is createActivitySpace()
-- (web/src/hooks/useSupabase.ts) enrolling the creator as the first owner of
-- a Space that was JUST created — at that moment no membership row exists
-- yet, so is_activity_space_owner() is necessarily false and the bootstrap
-- needs its own escape hatch. That escape hatch belongs to the *creator*,
-- not to anyone who can name the Space's UUID. Tying it to
-- activity_spaces.created_by preserves the bootstrap and closes the rest.
--
-- No other insert call site relies on the old unconditional branch
-- (grepped web/src: InviteUserDialog.tsx inserts the INVITEE's user_id, not
-- the caller's, so it only ever matches the owner-gated branch).
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and both tables live outside the migrations folder (base
-- schema).

do $migration$
begin
  if to_regclass('public.activity_space_members') is null
     or to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'activity_space_members self-insert fix skipped: base schema not present';
    return;
  end if;

  execute 'drop policy if exists activity_space_members_insert on public.activity_space_members';
  execute $sql$
    create policy activity_space_members_insert on public.activity_space_members
      for insert
      with check (
        (
          user_id = auth.uid()
          and exists (
            select 1 from public.activity_spaces s
            where s.id = activity_space_id and s.created_by = auth.uid()
          )
        )
        or is_activity_space_owner(activity_space_id)
      )
  $sql$;
end
$migration$;
