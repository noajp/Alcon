-- A Domain is created only inside a Space the creator belongs to, and moves
-- between Spaces only by someone who owns both (ELE_AI-105, ADR 0029).
--
-- "domains insert authenticated" checked only that user_id was the caller,
-- so anyone who knew a Space's UUID could create a Domain inside it. The
-- creator becomes that Domain's owner (domains_enrol_creator), and with it
-- enters the Space's roster (worker_in_space reads Domain membership) and
-- every boundary check that trusts "a Domain of this Space".
--
-- The same hole was open on UPDATE: "domains update members admin" lets a
-- Domain owner/admin change any column, so a Domain of one's own could be
-- moved into another Space (or out of one, taking its Objects along).
--
--   - INSERT: user_id is the caller, and activity_space_id is null or a Space
--     the caller is a member of.
--   - UPDATE of activity_space_id from a signed-in session: the caller must
--     own the Space the Domain leaves (if any) and the Space it joins (if
--     any). The update policy already requires an owner/admin of the Domain.
--     Server jobs and the service role (auth.uid() null) are left alone, and
--     so is deleting a Space: its Domains lose their Space through the FK
--     (on delete set null) after its memberships are gone.
--
-- Every existing Domain's creator is a member of its Space, so no data
-- changes.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.domains') is null
     or to_regclass('public.activity_space_members') is null
     or to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'domains_created_inside_your_space skipped: base schema not present';
    return;
  end if;

  execute 'create schema if not exists alcon_internal';

  execute 'drop policy if exists "domains insert authenticated" on public.domains';
  execute 'create policy "domains insert authenticated" on public.domains
    for insert to authenticated
    with check (
      auth.uid() is not null
      and user_id = auth.uid()
      and (activity_space_id is null or public.is_activity_space_member(activity_space_id))
    )';

  execute $f$
    create or replace function alcon_internal.domains_space_move_guard()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    begin
      if auth.uid() is null or new.activity_space_id is not distinct from old.activity_space_id then
        return new;
      end if;
      -- Deleting a Space sets its Domains' activity_space_id to null (FK
      -- on delete set null) after its memberships are gone; that is the
      -- Space delete itself, not a move.
      if new.activity_space_id is null
         and not exists (select 1 from public.activity_spaces s where s.id = old.activity_space_id) then
        return new;
      end if;
      if (old.activity_space_id is not null and not exists (
            select 1 from public.activity_space_members m
             where m.activity_space_id = old.activity_space_id
               and m.user_id = auth.uid() and m.role = 'owner'))
         or (new.activity_space_id is not null and not exists (
            select 1 from public.activity_space_members m
             where m.activity_space_id = new.activity_space_id
               and m.user_id = auth.uid() and m.role = 'owner')) then
        raise exception 'Only owners of both Spaces can move this Domain' using errcode = '42501';
      end if;
      return new;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.domains_space_move_guard() from public, anon, authenticated';
  execute 'drop trigger if exists domains_space_move_guard on public.domains';
  execute 'create trigger domains_space_move_guard before update of activity_space_id on public.domains
    for each row execute function alcon_internal.domains_space_move_guard()';
end $$;
