-- activity_space_members had SELECT, INSERT and DELETE policies, all
-- owner-scoped via `is_activity_space_owner(activity_space_id)`, but no
-- UPDATE policy at all. The table grants UPDATE to `authenticated` (checked
-- directly against `information_schema.role_table_grants`), so nothing at
-- the SQL layer stops a role change — RLS simply had no policy admitting any
-- row for that command, so every UPDATE silently touched zero rows. Owners
-- had insert (invite) and delete (remove) but no way to promote a member to
-- owner or demote a co-owner back to member, which is the gap el_QLT-022's
-- Member admin surface needs closed.
--
-- The new policy is the same shape as the existing insert/delete policies:
-- owner-only, via the same SECURITY DEFINER helper already trusted by this
-- table. It does not add a new privilege boundary, it completes the one that
-- was already half-built — the CLAUDE.md instruction to read existing
-- policies before loosening RLS is satisfied by that symmetry rather than by
-- inventing a new rule.
--
-- Guarded for preview replay: preview branches replay this folder against an
-- empty database, and both the table and its helper function live outside
-- the migrations folder (base schema).

do $migration$
begin
  if to_regclass('public.activity_space_members') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'activity_space_members role-update policy skipped: base schema not present';
    return;
  end if;

  execute 'drop policy if exists activity_space_members_update on public.activity_space_members';
  execute $sql$
    create policy activity_space_members_update on public.activity_space_members
      for update
      using (is_activity_space_owner(activity_space_id))
      with check (is_activity_space_owner(activity_space_id))
  $sql$;
end
$migration$;
