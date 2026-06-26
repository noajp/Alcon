-- ============================================================================
-- Backfill ActivitySpace membership from Domain membership.
--
-- A user invited to a Domain (domain_members) must also be a member of that
-- Domain's ActivitySpace — otherwise the space is RLS-invisible, so it never
-- shows in the switcher and the Domain is unreachable. Enrol every existing
-- domain member into their Domains' spaces. Idempotent; guarded for preview
-- branches where the base tables are absent.
-- ============================================================================
do $$
begin
  if to_regclass('public.domain_members') is null or to_regclass('public.domains') is null then
    return;
  end if;

  insert into public.activity_space_members (activity_space_id, user_id, role)
  select distinct d.activity_space_id, dm.user_id, 'member'
  from public.domain_members dm
  join public.domains d on d.id = dm.domain_id
  where d.activity_space_id is not null
  on conflict (activity_space_id, user_id) do nothing;
end $$;
