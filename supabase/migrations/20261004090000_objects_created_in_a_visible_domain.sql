-- An Object is created only in a Domain the creator can see, or with no
-- Domain at all (ELE_AI-107, ADR 0029).
--
-- "objects insert authenticated" checked only that someone was signed in, so
-- anyone who knew a Domain's UUID could create an Object inside it. The
-- creator becomes that Object's owner (objects_enrol_creator), and with it
-- enters the Domain's Space roster (worker_in_space reads Object membership)
-- and every boundary check that trusts "an Object of this Domain".
--
--   - INSERT: domain_id is null (a Domain-less Object; its only member is the
--     creator) or a Domain the caller can see (user_can_see_domain).
--
-- The bar is visibility, not Domain membership. A plain member creates
-- Objects in their Domain today (createObject, QuickAdd, Duplicate), and
-- import_existing_work creates its project in any Domain of the Space the
-- caller can see. Anyone who can see a Domain may join it as a member
-- (Discover), so requiring membership would add a step without keeping
-- anyone out; requiring owner/admin would break the member flows. What must
-- be refused is a Domain the caller cannot see — another org's Domain, or a
-- private Domain they were not let into.
--
-- user_id needs no check here: objects_stamp_creator sets it to auth.uid()
-- before the row is checked, and objects_creator_fixed keeps it.
--
-- Every existing Object predates this policy; no data changes.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.objects') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null then
    raise notice 'objects_created_in_a_visible_domain skipped: base schema not present';
    return;
  end if;

  execute 'drop policy if exists "objects insert authenticated" on public.objects';
  execute 'create policy "objects insert authenticated" on public.objects
    for insert to authenticated
    with check (
      auth.uid() is not null
      and (domain_id is null or public.user_can_see_domain(domain_id))
    )';
end $$;
