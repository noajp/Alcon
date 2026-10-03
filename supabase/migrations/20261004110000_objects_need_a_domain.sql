-- An Object always sits in a Domain (Domain → Object → Element).
--
-- Browsers create an Object only inside a Domain they can see; there is no
-- Domain-less Object to create. A signed-in session also cannot take an
-- Object out of its Domain (domain_id → null): moving it needs a target
-- Domain and the managers of both ends. When a Domain is deleted its Objects'
-- domain_id is cleared by the foreign key (on delete set null); that is the
-- delete itself, not a move, and still goes through. Objects that already
-- have no Domain stay as they are (older data); the rules for managing them
-- are unchanged.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.objects') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.object_members') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('alcon_internal.user_manages_scope_as(uuid, text, uuid)') is null then
    raise notice 'objects_need_a_domain skipped: base schema not present';
    return;
  end if;

  execute 'drop policy if exists "objects insert authenticated" on public.objects';
  execute 'create policy "objects insert authenticated" on public.objects
    for insert to authenticated
    with check (
      auth.uid() is not null
      and domain_id is not null
      and public.user_can_see_domain(domain_id)
    )';

  execute $f$
    create or replace function alcon_internal.objects_domain_move_guard()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    begin
      if auth.uid() is null or new.domain_id is not distinct from old.domain_id then
        return new;
      end if;
      if new.domain_id is null then
        -- Deleting the Domain clears domain_id (FK on delete set null): the
        -- delete itself, not a move. Otherwise an Object never leaves its
        -- Domain without going to another one.
        if old.domain_id is not null
           and not exists (select 1 from public.domains d where d.id = old.domain_id) then
          return new;
        end if;
        raise exception 'An Object must stay in a Domain; move it to another Domain instead' using errcode = '42501';
      end if;
      if old.domain_id is not null then
        if not alcon_internal.user_manages_scope_as(auth.uid(), 'domain', old.domain_id) then
          raise exception 'Only owners or admins of both Domains can move this Object' using errcode = '42501';
        end if;
      elsif not exists (select 1 from public.object_members
                         where object_id = old.id and user_id = auth.uid() and role in ('owner', 'admin')) then
        raise exception 'Only owners or admins of both Domains can move this Object' using errcode = '42501';
      end if;
      if not alcon_internal.user_manages_scope_as(auth.uid(), 'domain', new.domain_id) then
        raise exception 'Only owners or admins of both Domains can move this Object' using errcode = '42501';
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.objects_domain_move_guard() from public, anon, authenticated';
end $$;
