-- `role` was free `text` with no CHECK constraint. The new UPDATE policy
-- (el_QLT-022) admits any string via direct REST access, and
-- is_activity_space_owner() matches 'owner' exactly — so `role = 'Owner'`
-- (wrong case) or any other typo silently un-owns a row without tripping
-- the last-owner guard (which only recognizes the literal 'owner'). Existing
-- data is 100% 'owner'/'member' already (checked live before adding this).

do $migration$
begin
  if to_regclass('public.activity_space_members') is null then
    raise notice 'activity_space_members role check skipped: base schema not present';
    return;
  end if;

  execute 'alter table public.activity_space_members drop constraint if exists activity_space_members_role_check';
  execute $sql$
    alter table public.activity_space_members
      add constraint activity_space_members_role_check
      check (role in ('owner', 'member'))
  $sql$;
end
$migration$;
