-- Workers belong to a Space (ELE_QLT-090, phase 1 — additive; no policy is
-- tightened here).
--
-- Who can be ASSIGNED follows the Space boundary. A Worker's Space is decided
-- in this order:
--   user_id    the person's memberships (Space, Domain or Object member)
--   object_id  the Space of that Object
--   activity_space_id  only for a Worker with neither (an AI agent, or a
--              person without an account)
--
-- Schema    workers.activity_space_id (on delete set null) + index. Backfilled
--           for unlinked Workers whose assignments and leads all sit in one
--           Space; anything else stays NULL with a notice.
-- AI        every Space gets an ai_agent Worker 'Claude'; new Spaces get one
--           from a trigger.
-- Members   joining a Space / Domain / Object ensures the person has their
--           human Worker (trigger), so nobody inserts Worker rows for others.
-- Helpers   alcon_internal.*: element_home_space, object_home_space,
--           object_in_space, worker_in_space, the *_as visibility mirrors,
--           user_can_list_worker.
-- RPCs      public.worker_assignable(worker, element) and
--           public.list_assignable_workers(space, domain, element) — every
--           assignee picker and the board tools read these.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.workers') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.activity_spaces') is null
     or to_regclass('public.activity_space_members') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.object_members') is null
     or to_regclass('public.element_assignees') is null
     or to_regclass('public.object_domains') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'workers_belong_to_a_space skipped: base schema not present';
    return;
  end if;

  if not exists (select 1 from pg_namespace where nspname = 'alcon_internal') then
    execute 'create schema alcon_internal';
    execute 'revoke all on schema alcon_internal from public, anon, authenticated';
  end if;

  -- ── Schema ──────────────────────────────────────────────────────────────
  execute 'alter table public.workers add column if not exists activity_space_id uuid
    references public.activity_spaces(id) on delete set null';
  execute 'create index if not exists idx_workers_activity_space_id
    on public.workers (activity_space_id) where activity_space_id is not null';

  -- ── Where things live ───────────────────────────────────────────────────
  -- An Object's home Space: its primary Domain's Space, else the Space of a
  -- Domain it is filed under (primary row first).
  execute $f$
    create or replace function alcon_internal.object_home_space(p_object uuid)
    returns uuid language sql stable security definer set search_path = public as $b$
      select coalesce(
        (select d.activity_space_id from public.objects o
           join public.domains d on d.id = o.domain_id
          where o.id = p_object and d.activity_space_id is not null),
        (select d.activity_space_id from public.object_domains od
           join public.domains d on d.id = od.domain_id
          where od.object_id = p_object and d.activity_space_id is not null
          order by od.is_primary desc limit 1));
    $b$
  $f$;

  -- An Element's home Space is its primary Object's.
  execute $f$
    create or replace function alcon_internal.element_home_space(p_element uuid)
    returns uuid language sql stable security definer set search_path = public as $b$
      select alcon_internal.object_home_space(e.object_id)
        from public.elements e where e.id = p_element and e.object_id is not null;
    $b$
  $f$;

  -- An Object is in a Space when its Domain, or any Domain it is filed
  -- under, belongs to that Space.
  execute $f$
    create or replace function alcon_internal.object_in_space(p_object uuid, p_space uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.objects o join public.domains d on d.id = o.domain_id
                      where o.id = p_object and d.activity_space_id = p_space)
          or exists (select 1 from public.object_domains od join public.domains d on d.id = od.domain_id
                      where od.object_id = p_object and d.activity_space_id = p_space);
    $b$
  $f$;

  -- user_id decides first, then object_id, then activity_space_id.
  execute $f$
    create or replace function alcon_internal.worker_in_space(p_worker uuid, p_space uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from public.workers w
        where w.id = p_worker and p_space is not null and (
          (w.user_id is not null and (
             exists (select 1 from public.activity_space_members m
                      where m.activity_space_id = p_space and m.user_id = w.user_id)
             or exists (select 1 from public.domain_members dm join public.domains d on d.id = dm.domain_id
                         where dm.user_id = w.user_id and d.activity_space_id = p_space)
             or exists (select 1 from public.object_members om
                         where om.user_id = w.user_id and alcon_internal.object_in_space(om.object_id, p_space))))
          or (w.user_id is null and w.object_id is not null
              and alcon_internal.object_in_space(w.object_id, p_space))
          or (w.user_id is null and w.object_id is null and w.activity_space_id = p_space)));
    $b$
  $f$;

  -- ── Visibility as another person ────────────────────────────────────────
  -- Mirrors of the public helpers with auth.uid() replaced by p_user. Keep
  -- them in step with user_can_see_element / _object / _domain.
  execute $f$
    create or replace function alcon_internal.is_activity_space_member_as(p_space uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.activity_space_members
                      where activity_space_id = p_space and user_id = p_user);
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.user_is_domain_member_as(p_domain uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.domain_members
                      where domain_id = p_domain and user_id = p_user);
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.user_is_object_member_as(p_object uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.object_members
                      where object_id = p_object and user_id = p_user);
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.user_can_see_domain_as(p_domain uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from public.domains d
        where d.id = p_domain
          and (
            d.user_id = p_user
            or alcon_internal.user_is_domain_member_as(d.id, p_user)
            or (d.privacy = 'workspace'
                and d.activity_space_id is not null
                and alcon_internal.is_activity_space_member_as(d.activity_space_id, p_user))
          )
      );
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.user_can_see_object_as(p_object uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select
        alcon_internal.user_is_object_member_as(p_object, p_user)
        or exists (select 1 from public.objects o
                   where o.id = p_object and o.domain_id is not null
                     and alcon_internal.user_can_see_domain_as(o.domain_id, p_user))
        or exists (select 1 from public.object_domains od
                   where od.object_id = p_object
                     and alcon_internal.user_can_see_domain_as(od.domain_id, p_user));
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.user_can_see_element_as(p_element uuid, p_user uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select
        exists (
          select 1 from public.elements e
          where e.id = p_element
            and (
              e.owner_id = p_user
              or (e.object_id is not null and alcon_internal.user_can_see_object_as(e.object_id, p_user))
              or (e.object_id is null and e.owner_id is null
                  and not exists (select 1 from public.element_objects eo where eo.element_id = e.id))
            )
        )
        or exists (
          select 1 from public.element_objects eo
          where eo.element_id = p_element and alcon_internal.user_can_see_object_as(eo.object_id, p_user)
        );
    $b$
  $f$;

  -- ── Who the caller may list ─────────────────────────────────────────────
  execute $f$
    create or replace function alcon_internal.user_can_list_worker(p_worker uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and exists (
        select 1 from public.workers w
        where w.id = p_worker and (
          w.user_id = auth.uid()
          or (w.user_id is not null and (
               exists (select 1 from public.activity_space_members mine
                         join public.activity_space_members theirs
                           on theirs.activity_space_id = mine.activity_space_id
                        where mine.user_id = auth.uid() and theirs.user_id = w.user_id)
               or exists (select 1 from public.domain_members dm
                           where dm.user_id = w.user_id and public.user_can_see_domain(dm.domain_id))
               or exists (select 1 from public.object_members om
                           where om.user_id = w.user_id and public.user_can_see_object(om.object_id))))
          or (w.user_id is null and w.object_id is not null and public.user_can_see_object(w.object_id))
          or (w.user_id is null and w.object_id is null and w.activity_space_id is not null
              and public.is_activity_space_member(w.activity_space_id))));
    $b$
  $f$;

  execute 'revoke all on function alcon_internal.object_home_space(uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.element_home_space(uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.object_in_space(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.worker_in_space(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.is_activity_space_member_as(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_is_domain_member_as(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_is_object_member_as(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_can_see_domain_as(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_can_see_object_as(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_can_see_element_as(uuid, uuid) from public, anon, authenticated';
  -- Answers only about the caller; the workers SELECT policy will read it.
  execute 'revoke all on function alcon_internal.user_can_list_worker(uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_can_list_worker(uuid) to authenticated';

  -- ── Public RPCs ─────────────────────────────────────────────────────────
  execute $f$
    create or replace function public.worker_assignable(p_worker uuid, p_element uuid)
    returns boolean language plpgsql stable security definer set search_path = public as $b$
    declare
      w public.workers%rowtype;
      s uuid;
    begin
      if auth.uid() is null or p_worker is null or p_element is null then return false; end if;
      if not public.user_can_see_element(p_element) then return false; end if;
      if not alcon_internal.user_can_list_worker(p_worker) then return false; end if;
      select * into w from public.workers where id = p_worker;
      if not found or w.status is not distinct from 'inactive' then return false; end if;
      s := alcon_internal.element_home_space(p_element);
      if s is not null then
        if not alcon_internal.worker_in_space(p_worker, s) then return false; end if;
      elsif not (w.user_id is not null or w.object_id is not null
                 or (w.activity_space_id is not null and public.is_activity_space_member(w.activity_space_id))) then
        return false;
      end if;
      if w.user_id is not null and not alcon_internal.user_can_see_element_as(p_element, w.user_id) then
        return false;
      end if;
      return true;
    end;
    $b$
  $f$;

  -- With an Element: exactly the Workers worker_assignable accepts. Without
  -- one: the Workers the caller may list, in the given Space (a Domain's
  -- own Space when a Domain is given), narrowed to people who can see that
  -- Domain.
  execute $f$
    create or replace function public.list_assignable_workers(
      p_space_id uuid default null, p_domain_id uuid default null, p_element_id uuid default null)
    returns setof public.workers language plpgsql stable security definer set search_path = public as $b$
    declare
      v_space uuid := p_space_id;
    begin
      if auth.uid() is null then return; end if;
      if p_element_id is not null then
        if not public.user_can_see_element(p_element_id) then return; end if;
        return query
          select w.* from public.workers w
           where public.worker_assignable(w.id, p_element_id)
           order by w.type, w.name;
        return;
      end if;
      if p_domain_id is not null then
        if not public.user_can_see_domain(p_domain_id) then return; end if;
        v_space := coalesce((select d.activity_space_id from public.domains d where d.id = p_domain_id), p_space_id);
      end if;
      return query
        select w.* from public.workers w
         where alcon_internal.user_can_list_worker(w.id)
           and (v_space is null or alcon_internal.worker_in_space(w.id, v_space))
           and (p_domain_id is null or w.user_id is null
                or alcon_internal.user_can_see_domain_as(p_domain_id, w.user_id))
         order by w.type, w.name;
    end;
    $b$
  $f$;

  execute 'revoke all on function public.worker_assignable(uuid, uuid) from public, anon';
  execute 'grant execute on function public.worker_assignable(uuid, uuid) to authenticated';
  execute 'revoke all on function public.list_assignable_workers(uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function public.list_assignable_workers(uuid, uuid, uuid) to authenticated';

  -- ── Backfill: unlinked Workers whose work sits in exactly one Space ─────
  execute $f$
    do $b$
    declare
      r record;
      v_spaces uuid[];
    begin
      for r in
        select w.id, w.name from public.workers w
         where w.user_id is null and w.object_id is null and w.activity_space_id is null
      loop
        select coalesce(array_agg(distinct s), '{}') into v_spaces from (
          select alcon_internal.element_home_space(ea.element_id) as s
            from public.element_assignees ea where ea.worker_id = r.id
          union
          select alcon_internal.object_home_space(o.id)
            from public.objects o where o.lead_id = r.id
        ) x where s is not null;
        if cardinality(v_spaces) = 1 then
          update public.workers set activity_space_id = v_spaces[1] where id = r.id;
        else
          raise notice 'worker % (%) left without a Space: % Spaces', r.id, r.name, cardinality(v_spaces);
        end if;
      end loop;
    end;
    $b$
  $f$;

  -- ── An AI agent in every Space ──────────────────────────────────────────
  execute $f$
    create or replace function alcon_internal.ensure_space_ai_worker(p_space uuid)
    returns void language sql security definer set search_path = public as $b$
      insert into public.workers (type, name, ai_model, activity_space_id, status)
      select 'ai_agent', 'Claude',
             (select c.ai_model from public.workers c
               where c.type = 'ai_agent' and c.name = 'Claude'
               order by c.created_at nulls last limit 1),
             p_space, 'active'
       where not exists (select 1 from public.workers w
                          where w.type = 'ai_agent' and w.activity_space_id = p_space);
    $b$
  $f$;
  execute $f$
    create or replace function alcon_internal.activity_spaces_ensure_ai_worker()
    returns trigger language plpgsql security definer set search_path = public as $b$
    begin
      perform alcon_internal.ensure_space_ai_worker(new.id);
      return new;
    end;
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.ensure_space_ai_worker(uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.activity_spaces_ensure_ai_worker() from public, anon, authenticated';
  execute 'drop trigger if exists activity_spaces_ensure_ai_worker on public.activity_spaces';
  execute 'create trigger activity_spaces_ensure_ai_worker after insert on public.activity_spaces
    for each row execute function alcon_internal.activity_spaces_ensure_ai_worker()';
  perform alcon_internal.ensure_space_ai_worker(s.id) from public.activity_spaces s;

  -- ── Every member has their own human Worker ─────────────────────────────
  -- One global human Worker per account (workers_one_global_human_per_user);
  -- ON CONFLICT DO NOTHING keeps a concurrent insert from failing the join.
  execute $f$
    create or replace function alcon_internal.ensure_member_worker()
    returns trigger language plpgsql security definer set search_path = public as $b$
    begin
      if new.user_id is null then return new; end if;
      insert into public.workers (user_id, type, name, email, avatar_url, status)
      select new.user_id, 'human',
             coalesce(nullif(btrim(p.display_name), ''), u.email, 'Member'),
             u.email, p.avatar_url, 'active'
        from auth.users u
        left join public.profiles p on p.id = u.id
       where u.id = new.user_id
         and not exists (select 1 from public.workers w
                          where w.user_id = new.user_id and w.type = 'human' and w.object_id is null)
      on conflict do nothing;
      return new;
    end;
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.ensure_member_worker() from public, anon, authenticated';
  execute 'drop trigger if exists activity_space_members_ensure_worker on public.activity_space_members';
  execute 'create trigger activity_space_members_ensure_worker after insert on public.activity_space_members
    for each row execute function alcon_internal.ensure_member_worker()';
  execute 'drop trigger if exists domain_members_ensure_worker on public.domain_members';
  execute 'create trigger domain_members_ensure_worker after insert on public.domain_members
    for each row execute function alcon_internal.ensure_member_worker()';
  execute 'drop trigger if exists object_members_ensure_worker on public.object_members';
  execute 'create trigger object_members_ensure_worker after insert on public.object_members
    for each row execute function alcon_internal.ensure_member_worker()';
end $$;
