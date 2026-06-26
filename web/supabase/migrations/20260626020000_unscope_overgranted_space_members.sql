-- ============================================================================
-- Undo over-granted ActivitySpace membership.
--
-- Inviting someone to a single Domain (project) must NOT make them a member of
-- the whole ActivitySpace (company) — that would expose the entire space. A
-- prior backfill enrolled every domain member into their Domains' spaces; remove
-- those. Space membership = the company; keep only the space *creator* (owner).
-- Domain access stays via domain_members and surfaces as a "guest" Domain.
--
-- Guarded + safe: today the only legitimate space members are creators, so any
-- non-creator membership is the over-grant.
-- ============================================================================
do $$
begin
  if to_regclass('public.activity_space_members') is null
     or to_regclass('public.activity_spaces') is null then
    return;
  end if;

  delete from public.activity_space_members asm
  using public.activity_spaces s
  where s.id = asm.activity_space_id
    and asm.user_id <> s.created_by;
end $$;
