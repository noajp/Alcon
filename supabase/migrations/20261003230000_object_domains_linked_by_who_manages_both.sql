-- An Object is filed under an additional Domain only by someone who manages
-- both (ELE_AI-106, ADR 0029).
--
-- object_domains_via_domain (ALL) let a Domain's creator write any row whose
-- domain_id was their Domain, with any object_id. user_can_see_object reads
-- object_domains, so linking a foreign Object into one's own Domain made that
-- Object — and its Elements — visible to everyone who can see the Domain.
-- Manager checks (user_manages_scope_as) read only objects.domain_id, so this
-- leaked visibility, not management.
--
--   Managing an Object means what objects_domain_move_guard means by it: an
--   owner/admin of its primary Domain, or — only for an Object with no
--   Domain — an owner/admin of the Object itself. Every creator is an Object
--   owner, so counting Object owners for a Domain-homed Object would let a
--   plain Domain member push their Object (and the Elements others put in
--   it) into another Space's Domain, which the move guard already refuses.
--
--   - INSERT / UPDATE: the caller manages the Object and is an owner/admin
--     of the Domain. A row that repeats the Object's own primary Domain adds
--     no visibility, so an owner/admin of the Object may write it too — that
--     is what createObject and import_existing_work write for a new Object.
--   - DELETE: the caller manages the Object or is an owner/admin of the
--     Domain (and, as for every read, can see the row). Removing a link only
--     narrows visibility, and either side may take the Object out.
--   - SELECT stays object_domains_visible_select (the Domain and the Object
--     are both visible to the caller).
--
-- The two existing rows repeat their Object's primary Domain, so no data
-- changes.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.object_domains') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.object_members') is null
     or to_regprocedure('alcon_internal.user_manages_scope_as(uuid, text, uuid)') is null then
    raise notice 'object_domains_linked_by_who_manages_both skipped: base schema not present';
    return;
  end if;

  execute $f$
    create or replace function alcon_internal.user_manages_object(p_object uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$
      select auth.uid() is not null and exists (
        select 1 from public.objects o
         where o.id = p_object
           and case when o.domain_id is not null
                 then alcon_internal.user_manages_scope_as(auth.uid(), 'domain', o.domain_id)
                 else exists (select 1 from public.object_members om
                               where om.object_id = o.id and om.user_id = auth.uid()
                                 and om.role in ('owner', 'admin'))
               end
      )
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.user_can_link_object_domain(p_object uuid, p_domain uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$
      select auth.uid() is not null and (
        (alcon_internal.user_manages_object(p_object)
         and alcon_internal.user_manages_scope_as(auth.uid(), 'domain', p_domain))
        or (exists (select 1 from public.objects o
                     where o.id = p_object and o.domain_id = p_domain)
            and exists (select 1 from public.object_members om
                         where om.object_id = p_object and om.user_id = auth.uid()
                           and om.role in ('owner', 'admin')))
      )
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.user_can_unlink_object_domain(p_object uuid, p_domain uuid)
    returns boolean language sql stable security definer set search_path = ''
    as $b$
      select alcon_internal.user_manages_object(p_object)
        or alcon_internal.user_manages_scope_as(auth.uid(), 'domain', p_domain)
    $b$
  $f$;

  execute 'revoke all on function alcon_internal.user_manages_object(uuid) from public, anon';
  execute 'revoke all on function alcon_internal.user_can_link_object_domain(uuid, uuid) from public, anon';
  execute 'revoke all on function alcon_internal.user_can_unlink_object_domain(uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_manages_object(uuid) to authenticated';
  execute 'grant execute on function alcon_internal.user_can_link_object_domain(uuid, uuid) to authenticated';
  execute 'grant execute on function alcon_internal.user_can_unlink_object_domain(uuid, uuid) to authenticated';

  execute 'drop policy if exists object_domains_via_domain on public.object_domains';
  execute 'drop policy if exists object_domains_insert on public.object_domains';
  execute 'drop policy if exists object_domains_update on public.object_domains';
  execute 'drop policy if exists object_domains_delete on public.object_domains';
  execute 'create policy object_domains_insert on public.object_domains
    for insert to authenticated
    with check (alcon_internal.user_can_link_object_domain(object_id, domain_id))';
  execute 'create policy object_domains_update on public.object_domains
    for update to authenticated
    using (alcon_internal.user_can_link_object_domain(object_id, domain_id))
    with check (alcon_internal.user_can_link_object_domain(object_id, domain_id))';
  execute 'create policy object_domains_delete on public.object_domains
    for delete to authenticated
    using (alcon_internal.user_can_unlink_object_domain(object_id, domain_id))';
end $$;
