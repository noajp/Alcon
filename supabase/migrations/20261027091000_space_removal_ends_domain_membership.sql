-- Leaving a Space, or being removed from it, ends the person's membership in
-- that Space's Domains and their Objects.
--
-- Space, Domain and Object membership are separate rows, and every Domain
-- read and work helper accepts a domain_members row on its own. So a person
-- removed from a Space kept reading and changing the Domains they had
-- created or joined there. The Space owner could not take those rows away,
-- because only a Domain's own owners and admins manage it, and the last-owner
-- guard refused to remove a Domain's sole owner.
--
-- After a Space membership row goes, the person's domain_members rows for
-- Domains in that Space go too, and so do their object_members rows for
-- Objects filed under those Domains. Where they were the last owner, a Space
-- owner takes the ownership over first, so nothing is left without an owner:
-- the one who removed them if that is a Space owner, otherwise the
-- longest-standing Space owner.
--
-- People invited to a Domain from outside the Space (guests) never had a
-- Space membership row and are not touched. Deleting the Space itself
-- cascades as before.
do $m$
begin
  if to_regclass('public.activity_space_members') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.object_members') is null
     or to_regclass('public.object_domains') is null then
    raise notice 'space removal ends domain membership skipped: tables not present'; return;
  end if;

  execute 'create schema if not exists alcon_internal';

  execute $f$
    create or replace function alcon_internal.end_scope_membership_with_space()
    returns trigger language plpgsql security definer set search_path = ''
    as $b$
    declare
      v_space uuid := old.activity_space_id;
      v_user uuid := old.user_id;
      v_heir uuid;
      v_domain uuid;
      v_object uuid;
    begin
      if not exists (select 1 from public.activity_spaces where id = v_space) then
        return old;
      end if;

      select m.user_id into v_heir
        from public.activity_space_members m
       where m.activity_space_id = v_space and m.role = 'owner' and m.user_id <> v_user
       order by (m.user_id = auth.uid()) desc, m.created_at, m.user_id
       limit 1;

      for v_domain in
        select dm.domain_id
          from public.domain_members dm
          join public.domains d on d.id = dm.domain_id
         where dm.user_id = v_user and d.activity_space_id = v_space
      loop
        if v_heir is not null
           and exists (select 1 from public.domain_members
                        where domain_id = v_domain and user_id = v_user and role = 'owner')
           and not exists (select 1 from public.domain_members
                            where domain_id = v_domain and role = 'owner' and user_id <> v_user) then
          insert into public.domain_members (domain_id, user_id, role)
          values (v_domain, v_heir, 'owner')
          on conflict (domain_id, user_id) do update set role = 'owner';
        end if;
        delete from public.domain_members where domain_id = v_domain and user_id = v_user;
      end loop;

      for v_object in
        select om.object_id
          from public.object_members om
         where om.user_id = v_user
           and (exists (select 1 from public.objects o
                          join public.domains d on d.id = o.domain_id
                         where o.id = om.object_id and d.activity_space_id = v_space)
                or exists (select 1 from public.object_domains od
                             join public.domains d on d.id = od.domain_id
                            where od.object_id = om.object_id and d.activity_space_id = v_space))
      loop
        if v_heir is not null
           and exists (select 1 from public.object_members
                        where object_id = v_object and user_id = v_user and role = 'owner')
           and not exists (select 1 from public.object_members
                            where object_id = v_object and role = 'owner' and user_id <> v_user) then
          insert into public.object_members (object_id, user_id, role)
          values (v_object, v_heir, 'owner')
          on conflict (object_id, user_id) do update set role = 'owner';
        end if;
        delete from public.object_members where object_id = v_object and user_id = v_user;
      end loop;

      return old;
    end
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.end_scope_membership_with_space() from public, anon, authenticated';

  execute 'drop trigger if exists activity_space_members_end_scope_membership on public.activity_space_members';
  execute 'create trigger activity_space_members_end_scope_membership after delete on public.activity_space_members
    for each row execute function alcon_internal.end_scope_membership_with_space()';
end $m$;
