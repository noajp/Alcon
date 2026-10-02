-- Workers follow the Space boundary (ELE_QLT-090, phase 2 — the enforcing
-- half; phase 1 added the helpers and RPCs every caller now reads).
--
-- workers            SELECT  yourself; anyone you may list (user_can_list_worker);
--                            an assignee of a visible Element; the lead of a
--                            visible Object or a Person value on a visible
--                            Element when the Worker belongs to that Space —
--                            so past work keeps its names.
--                    INSERT  your own human Worker; an unlinked Worker in a
--                            Space you belong to; an Object's Worker on a
--                            visible Object.
--                    UPDATE  user_can_manage_worker, before and after the
--                            change; a trigger limits the columns. A person's
--                            Worker is never unlinked, re-linked or retyped;
--                            only the person edits its profile, an owner of
--                            their Space or Domain only capacity and status.
--                            Connect links a human Object Worker, by an owner.
--                    DELETE  an unlinked Worker, by an owner of its Space.
-- Object Workers     a Worker with an object_id belongs to its Object even when
--                    connected to an account: worker_in_space and
--                    user_can_list_worker read the Object first, so a persona
--                    made in one Object never shows up in the person's other
--                    Spaces (get_now_work follows).
-- element_assignees  read / remove on visible Elements; add only what
--                    worker_assignable accepts.
-- agent_runs         a run names only an assignable Worker.
-- Notifications      every Element notification goes only to people who can
--                    see the Element (user_can_see_element_as).
-- Also               set_worker_display_id numbers across every Worker, not
--                    just the ones the caller sees; import_existing_work checks
--                    assignees with worker_assignable.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  if to_regclass('public.workers') is null
     or to_regclass('public.element_assignees') is null
     or to_regclass('public.agent_runs') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.element_comments') is null
     or to_regclass('public.activity_space_members') is null
     or to_regclass('public.domain_members') is null
     or to_regclass('public.object_members') is null
     or to_regclass('public.object_domains') is null
     or to_regclass('public.custom_columns') is null
     or to_regclass('public.custom_column_values') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('public.worker_assignable(uuid, uuid)') is null
     or to_regprocedure('public.set_worker_display_id()') is null
     or to_regprocedure('public.notify_element_status()') is null
     or to_regprocedure('public.notify_element_comment()') is null
     or to_regprocedure('public.generate_due_soon_notifications()') is null
     or to_regprocedure('alcon_internal.user_can_list_worker(uuid)') is null
     or to_regprocedure('alcon_internal.user_can_see_element_as(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.is_activity_space_member_as(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.user_is_domain_member_as(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.object_in_space(uuid, uuid)') is null
     or to_regprocedure('alcon_internal.object_home_space(uuid)') is null
     or to_regprocedure('alcon_internal.element_home_space(uuid)') is null
     or to_regprocedure('alcon_internal.worker_in_space(uuid, uuid)') is null
     or to_regprocedure('public.get_now_work(uuid)') is null then
    raise notice 'workers_rls_and_notify_recipients skipped: base schema not present';
    return;
  end if;

  -- Policies run as the caller and read alcon_internal helpers.
  execute 'grant usage on schema alcon_internal to authenticated';

  -- ── An Object's Worker belongs to its Object ────────────────────────────
  -- object_id decides first, then user_id, then activity_space_id. A Worker
  -- with both an Object and an account is that Object's persona of the
  -- person: it is in the Object's Space and listed by whoever can see the
  -- Object. Reading the person's memberships instead would let anyone who
  -- adds someone to their own Space, then connects a made-up Object Worker
  -- to them, place that persona in the person's other organisations.
  -- worker_assignable still requires the linked person to see the Element.
  execute $f$
    create or replace function alcon_internal.worker_in_space(p_worker uuid, p_space uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from public.workers w
        where w.id = p_worker and p_space is not null and (
          (w.object_id is not null and alcon_internal.object_in_space(w.object_id, p_space))
          or (w.object_id is null and w.user_id is not null and (
             exists (select 1 from public.activity_space_members m
                      where m.activity_space_id = p_space and m.user_id = w.user_id)
             or exists (select 1 from public.domain_members dm join public.domains d on d.id = dm.domain_id
                         where dm.user_id = w.user_id and d.activity_space_id = p_space)
             or exists (select 1 from public.object_members om
                         where om.user_id = w.user_id and alcon_internal.object_in_space(om.object_id, p_space))))
          or (w.user_id is null and w.object_id is null and w.activity_space_id = p_space)));
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.user_can_list_worker(p_worker uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and exists (
        select 1 from public.workers w
        where w.id = p_worker and (
          w.user_id = auth.uid()
          or (w.object_id is not null and public.user_can_see_object(w.object_id))
          or (w.object_id is null and w.user_id is not null and (
               exists (select 1 from public.activity_space_members mine
                         join public.activity_space_members theirs
                           on theirs.activity_space_id = mine.activity_space_id
                        where mine.user_id = auth.uid() and theirs.user_id = w.user_id)
               or exists (select 1 from public.domain_members dm
                           where dm.user_id = w.user_id and public.user_can_see_domain(dm.domain_id))
               or exists (select 1 from public.object_members om
                           where om.user_id = w.user_id and public.user_can_see_object(om.object_id))))
          or (w.user_id is null and w.object_id is null and w.activity_space_id is not null
              and public.is_activity_space_member(w.activity_space_id))));
    $b$
  $f$;
  execute 'revoke all on function alcon_internal.worker_in_space(uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_can_list_worker(uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_can_list_worker(uuid) to authenticated';

  -- get_now_work lists the Space's members' Workers; an Object persona of a
  -- member is not one of them (it comes in through its Object, when that
  -- Object is in scope).
  v_def := pg_get_functiondef('public.get_now_work(uuid)'::regprocedure);
  v_old := 'and exists(select 1 from public.activity_space_members member where member.activity_space_id=p_space_id and member.user_id=w.user_id))';
  v_new := 'and w.object_id is null and exists(select 1 from public.activity_space_members member where member.activity_space_id=p_space_id and member.user_id=w.user_id))';
  if position(v_new in v_def) = 0 then
    if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
      raise exception 'get_now_work: the member branch is not where this migration expects it';
    end if;
    execute replace(v_def, v_old, v_new);
  end if;

  -- ── Display: who the caller may see ─────────────────────────────────────
  -- Everything beyond the row's own columns; the policy checks those inline
  -- so INSERT … RETURNING sees the row it is writing. An assignment can only
  -- be written through worker_assignable, so it is trusted as it stands. An
  -- Object's lead and a Person value are plain columns anyone with the row can
  -- set, so they reveal a Worker only when it belongs to that Space — a lead
  -- pointed at another organisation's Worker shows nothing.
  execute $f$
    create or replace function alcon_internal.user_can_see_worker(p_worker uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and (
        alcon_internal.user_can_list_worker(p_worker)
        or exists (select 1 from public.element_assignees ea
                    where ea.worker_id = p_worker and public.user_can_see_element(ea.element_id))
        or exists (select 1 from public.objects o
                    where o.lead_id = p_worker and public.user_can_see_object(o.id)
                      and alcon_internal.worker_in_space(p_worker, alcon_internal.object_home_space(o.id)))
        or exists (select 1 from public.custom_column_values v
                     join public.custom_columns c on c.id = v.column_id
                    where c.column_type = 'person' and v.value = to_jsonb(p_worker::text)
                      and v.element_id is not null and public.user_can_see_element(v.element_id)
                      and alcon_internal.worker_in_space(p_worker, alcon_internal.element_home_space(v.element_id))));
    $b$
  $f$;

  -- ── Management: who may change a Worker ─────────────────────────────────
  -- Owner of the Worker's scope, from its columns, in worker_in_space's
  -- order: an owner of a Space the Worker belongs to (object → the Object is
  -- in it, else user → any membership in that Space, else activity_space_id),
  -- or an owner of a Domain it belongs to (object → filed under the Domain,
  -- else user → Domain member, else a Domain of its Space).
  execute $f$
    create or replace function alcon_internal.user_owns_worker_fields(p_user uuid, p_object uuid, p_space uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and (
        exists (
          select 1 from public.activity_space_members m
           where m.user_id = auth.uid() and m.role = 'owner' and (
             (p_user is not null and p_object is null and (
                alcon_internal.is_activity_space_member_as(m.activity_space_id, p_user)
                or exists (select 1 from public.domain_members dm join public.domains d on d.id = dm.domain_id
                            where dm.user_id = p_user and d.activity_space_id = m.activity_space_id)
                or exists (select 1 from public.object_members om
                            where om.user_id = p_user
                              and alcon_internal.object_in_space(om.object_id, m.activity_space_id))))
             or (p_object is not null and alcon_internal.object_in_space(p_object, m.activity_space_id))
             or (p_user is null and p_object is null and p_space = m.activity_space_id)))
        or exists (
          select 1 from public.domain_members mine join public.domains d on d.id = mine.domain_id
           where mine.user_id = auth.uid() and mine.role = 'owner' and (
             (p_user is not null and p_object is null and alcon_internal.user_is_domain_member_as(d.id, p_user))
             or (p_object is not null and (
                  exists (select 1 from public.objects o where o.id = p_object and o.domain_id = d.id)
                  or exists (select 1 from public.object_domains od
                              where od.object_id = p_object and od.domain_id = d.id)))
             or (p_user is null and p_object is null and p_space is not null
                 and d.activity_space_id = p_space))));
    $b$
  $f$;

  -- Yourself; an unlinked Worker of a Space you belong to; an Object's Worker
  -- on an Object you can see; anyone else's Worker as an owner of their scope.
  execute $f$
    create or replace function alcon_internal.user_can_manage_worker_fields(p_user uuid, p_object uuid, p_space uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select auth.uid() is not null and (
        p_user = auth.uid()
        or (p_user is null and p_object is null and p_space is not null
            and public.is_activity_space_member(p_space))
        or (p_user is null and p_object is not null and public.user_can_see_object(p_object))
        or (p_user is not null and alcon_internal.user_owns_worker_fields(p_user, p_object, p_space)));
    $b$
  $f$;

  execute $f$
    create or replace function alcon_internal.user_can_manage_worker(p_worker uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select coalesce((select alcon_internal.user_can_manage_worker_fields(w.user_id, w.object_id, w.activity_space_id)
                         from public.workers w where w.id = p_worker), false);
    $b$
  $f$;

  -- Which columns may move, by whom. Service-role and database-internal
  -- writes (no auth.uid()) pass.
  --   Everyone   type and identity never change.
  --   A person's Worker (user_id set) is never unlinked, re-linked or moved to
  --              a Space or Object: its Space comes from memberships, and an
  --              unlinked one could then be deleted with its assignments.
  --              Only the person edits the rest; an owner of their Space or
  --              Domain (user_can_manage_worker) changes capacity and status.
  --   Connect    links a human Object Worker to someone in that Object's
  --              Space, by an owner of the Object's Space or Domain. A Space's
  --              unlinked roster Worker is never linked: every account already
  --              has its own human Worker.
  --   Moving     an unlinked Worker only into a Space you belong to, an Object
  --              Worker only into an Object you can see.
  execute $f$
    create or replace function alcon_internal.workers_guard_update()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare
      v_uid uuid := auth.uid();
      v_space uuid;
    begin
      if v_uid is null then return new; end if;
      if new.id is distinct from old.id or new.type is distinct from old.type
         or new.seq_number is distinct from old.seq_number or new.display_id is distinct from old.display_id
         or new.created_at is distinct from old.created_at then
        raise exception 'A Worker''s type and identity cannot change' using errcode = '42501';
      end if;

      if old.user_id is not null then
        if new.user_id is distinct from old.user_id or new.object_id is distinct from old.object_id
           or new.activity_space_id is distinct from old.activity_space_id then
          raise exception 'A person''s Worker stays linked to them' using errcode = '42501';
        end if;
        if old.user_id <> v_uid
           and (to_jsonb(new) - 'capacity_hours_per_day' - 'status' - 'updated_at')
               is distinct from (to_jsonb(old) - 'capacity_hours_per_day' - 'status' - 'updated_at') then
          raise exception 'Only this person can change their Worker; an owner may change its capacity and status'
            using errcode = '42501';
        end if;
        return new;
      end if;

      if new.user_id is not null then
        v_space := alcon_internal.object_home_space(old.object_id);
        if old.object_id is null or old.type is distinct from 'human'
           or new.object_id is distinct from old.object_id
           or not alcon_internal.user_owns_worker_fields(null, old.object_id, old.activity_space_id)
           or v_space is null
           or not (alcon_internal.is_activity_space_member_as(v_space, new.user_id)
                   or exists (select 1 from public.domain_members dm join public.domains d on d.id = dm.domain_id
                               where dm.user_id = new.user_id and d.activity_space_id = v_space)
                   or exists (select 1 from public.object_members om
                               where om.user_id = new.user_id and alcon_internal.object_in_space(om.object_id, v_space))) then
          raise exception 'Only an owner of the Object''s Space or Domain can connect its human Worker, to someone in that Space'
            using errcode = '42501';
        end if;
      end if;
      if new.activity_space_id is distinct from old.activity_space_id and new.activity_space_id is not null
         and not public.is_activity_space_member(new.activity_space_id) then
        raise exception 'A Worker can only move into a Space you belong to' using errcode = '42501';
      end if;
      if new.object_id is distinct from old.object_id and new.object_id is not null
         and not public.user_can_see_object(new.object_id) then
        raise exception 'A Worker can only move into an Object you can see' using errcode = '42501';
      end if;
      return new;
    end;
    $b$
  $f$;

  execute 'revoke all on function alcon_internal.user_can_see_worker(uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_can_see_worker(uuid) to authenticated';
  execute 'revoke all on function alcon_internal.user_owns_worker_fields(uuid, uuid, uuid) from public, anon, authenticated';
  execute 'revoke all on function alcon_internal.user_can_manage_worker_fields(uuid, uuid, uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_can_manage_worker_fields(uuid, uuid, uuid) to authenticated';
  execute 'revoke all on function alcon_internal.user_can_manage_worker(uuid) from public, anon';
  execute 'grant execute on function alcon_internal.user_can_manage_worker(uuid) to authenticated';
  execute 'revoke all on function alcon_internal.workers_guard_update() from public, anon, authenticated';

  execute 'drop trigger if exists workers_guard_update on public.workers';
  execute 'create trigger workers_guard_update before update on public.workers
    for each row execute function alcon_internal.workers_guard_update()';

  -- Numbering reads every Worker; under the new SELECT policy an invoker
  -- would see only some of them and reuse a display_id.
  execute 'alter function public.set_worker_display_id() security definer';
  execute 'revoke all on function public.set_worker_display_id() from public, anon, authenticated';

  -- The display policy probes Object leads per Worker.
  execute 'create index if not exists idx_objects_lead_id on public.objects (lead_id) where lead_id is not null';

  -- ── workers policies ────────────────────────────────────────────────────
  execute 'drop policy if exists "Authenticated full access" on public.workers';
  execute 'drop policy if exists workers_select on public.workers';
  execute 'drop policy if exists workers_insert on public.workers';
  execute 'drop policy if exists workers_update on public.workers';
  execute 'drop policy if exists workers_delete on public.workers';
  execute $p$
    create policy workers_select on public.workers for select to authenticated using (
      user_id = (select auth.uid())
      or (user_id is null and object_id is null and activity_space_id is not null
          and public.is_activity_space_member(activity_space_id))
      or (user_id is null and object_id is not null and public.user_can_see_object(object_id))
      or alcon_internal.user_can_see_worker(id))
  $p$;
  execute $p$
    create policy workers_insert on public.workers for insert to authenticated with check (
      (user_id = (select auth.uid()) and object_id is null and type = 'human')
      or (user_id is null and object_id is null and public.is_activity_space_member(activity_space_id))
      or (user_id is null and object_id is not null and public.user_can_see_object(object_id)))
  $p$;
  -- USING reads the stored row; WITH CHECK reads the new columns (a helper
  -- that looks the Worker up by id would still see the old row there). Which
  -- columns may change is the trigger's.
  execute $p$
    create policy workers_update on public.workers for update to authenticated
      using (alcon_internal.user_can_manage_worker(id))
      with check (alcon_internal.user_can_manage_worker_fields(user_id, object_id, activity_space_id))
  $p$;
  -- A person's Worker is never unlinked from the app (trigger above), so it
  -- never becomes deletable here.
  execute $p$
    create policy workers_delete on public.workers for delete to authenticated using (
      user_id is null and object_id is null and public.is_activity_space_owner(activity_space_id))
  $p$;

  -- ── element_assignees policies ──────────────────────────────────────────
  execute 'drop policy if exists "Authenticated full access" on public.element_assignees';
  execute 'drop policy if exists element_assignees_select on public.element_assignees';
  execute 'drop policy if exists element_assignees_insert on public.element_assignees';
  execute 'drop policy if exists element_assignees_update on public.element_assignees';
  execute 'drop policy if exists element_assignees_delete on public.element_assignees';
  execute 'create policy element_assignees_select on public.element_assignees for select to authenticated
    using (public.user_can_see_element(element_id))';
  execute 'create policy element_assignees_insert on public.element_assignees for insert to authenticated
    with check (public.worker_assignable(worker_id, element_id))';
  execute 'create policy element_assignees_update on public.element_assignees for update to authenticated
    using (public.user_can_see_element(element_id))
    with check (public.worker_assignable(worker_id, element_id))';
  -- Removing stays open on a visible Element, so an assignee from before the
  -- boundary can still be taken off.
  execute 'create policy element_assignees_delete on public.element_assignees for delete to authenticated
    using (public.user_can_see_element(element_id))';

  -- ── agent_runs: a run names only an assignable Worker ───────────────────
  execute 'drop policy if exists agent_runs_insert on public.agent_runs';
  execute 'create policy agent_runs_insert on public.agent_runs for insert to authenticated
    with check (public.user_can_see_element(element_id) and triggered_by = auth.uid()
                and (worker_id is null or public.worker_assignable(worker_id, element_id)))';

  -- ── Notifications reach only people who can see the Element ─────────────
  execute $f$
    create or replace function public.notify_element_status()
    returns trigger language plpgsql security definer set search_path = '' as $b$
    declare
      v_actor uuid := auth.uid();
      v_suffix text := case new.status when 'done' then ' is done' else ' is blocked' end;
    begin
      if exists (select 1 from public.element_check_ins ci
        where ci.request_id::text=current_setting('alcon.check_in_request',true)
          and ci.transaction_id=pg_current_xact_id() and ci.element_id=new.id
          and ci.author_id=v_actor and ci.result_updated_at=new.updated_at) then
        return new;
      end if;
      insert into public.notifications (recipient_id, actor_id, kind, element_id, title, body)
      select distinct r.user_id, v_actor, 'status_change', new.id,
        new.title || v_suffix, coalesce(old.status, '—') || ' → ' || new.status
      from (
        select w.user_id from public.element_assignees ea join public.workers w on w.id=ea.worker_id
          where ea.element_id=new.id and w.user_id is not null
        union select new.owner_id where new.owner_id is not null
        union select d.user_id from public.objects o join public.domains d on d.id=o.domain_id
          where o.id=new.object_id and d.user_id is not null
      ) r where r.user_id is not null and (v_actor is null or r.user_id<>v_actor)
        and alcon_internal.user_can_see_element_as(new.id, r.user_id);
      return new;
    end;
    $b$
  $f$;

  execute $f$
    create or replace function public.notify_element_comment()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare
      v_element text;
      v_author  text := coalesce(nullif(new.author_name, ''), 'Someone');
    begin
      select e.title into v_element from elements e where e.id = new.element_id;
      if v_element is null then return new; end if; -- element gone; nothing to say

      -- Named people, whoever wrote the comment. For an agent this is the
      -- whole delivery path. Only people who can see the Element.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, element_id, comment_id, title, body)
      select distinct m, new.author_id, new.author_name, 'mention',
             new.element_id, new.id,
             v_author || ' mentioned you in ' || v_element, left(new.content, 140)
      from unnest(new.mentions) as m
      where (new.author_id is null or m <> new.author_id)
        and alcon_internal.user_can_see_element_as(new.element_id, m);

      if new.author_kind = 'ai_agent' then
        return new;
      end if;

      -- Written by a person: the users behind assigned Workers, the Element's
      -- owner, the owner of the Domain it lives in, and everyone already in
      -- the thread — minus the author, minus anyone named above, and minus
      -- anyone who can no longer see the Element.
      insert into notifications
        (recipient_id, actor_id, actor_name, kind, element_id, comment_id, title, body)
      select distinct r.user_id, new.author_id, new.author_name, 'comment',
             new.element_id, new.id,
             v_author || ' commented on ' || v_element, left(new.content, 140)
      from (
        select w.user_id
        from element_assignees ea
        join workers w on w.id = ea.worker_id
        where ea.element_id = new.element_id and w.user_id is not null
        union
        select e.owner_id from elements e
        where e.id = new.element_id and e.owner_id is not null
        union
        select d.user_id
        from elements e
        join objects o on o.id = e.object_id
        join domains d on d.id = o.domain_id
        where e.id = new.element_id and d.user_id is not null
        union
        select c.author_id
        from element_comments c
        where c.element_id = new.element_id
          and c.author_kind = 'human'
          and c.author_id is not null
      ) r
      where r.user_id is not null
        and (new.author_id is null or r.user_id <> new.author_id)
        and not (r.user_id = any (new.mentions))
        and alcon_internal.user_can_see_element_as(new.element_id, r.user_id);

      return new;
    end
    $b$
  $f$;

  execute $f$
    create or replace function public.generate_due_soon_notifications()
    returns void language plpgsql security definer set search_path = public, pg_catalog as $b$
    begin
      insert into notifications (recipient_id, kind, element_id, title, body)
      select c.recipient_id, 'due_soon', c.element_id, c.title, c.body
      from (
        select distinct
          e.id as element_id,
          w.user_id as recipient_id,
          coalesce(e.title, 'Untitled') || ' is due ' || to_char(e.due_date, 'YYYY-MM-DD') as title,
          'Due ' || to_char(e.due_date, 'YYYY-MM-DD') as body
        from elements e
        join objects o on o.id = e.object_id
        join domains d on d.id = o.domain_id
        join lateral (
          select case
            when jsonb_typeof(d.risk_thresholds -> 'due_soon_days') = 'number'
                 and (d.risk_thresholds ->> 'due_soon_days')::numeric > 0
                 and (d.risk_thresholds ->> 'due_soon_days')::numeric <= 3650
            then (d.risk_thresholds ->> 'due_soon_days')::numeric
            else 3
          end as due_soon_days
        ) t on true
        join element_assignees ea on ea.element_id = e.id
        join workers w on w.id = ea.worker_id
        where w.user_id is not null
          and e.status in ('backlog', 'todo')
          and e.due_date is not null
          and e.due_date >= current_date
          and e.due_date <= current_date + make_interval(days => t.due_soon_days::int)
          and alcon_internal.user_can_see_element_as(e.id, w.user_id)
      ) c
      where c.body is distinct from (
        select n.body
        from notifications n
        where n.element_id = c.element_id
          and n.recipient_id = c.recipient_id
          and n.kind = 'due_soon'
        order by n.created_at desc
        limit 1
      );
    end
    $b$
  $f$;

  -- ── Import: assignees pass the same check as every other assignment ─────
  if to_regprocedure('public.import_existing_work(uuid, uuid, uuid, uuid, text, jsonb)') is not null
     and to_regclass('public.work_import_receipts') is not null
     and to_regclass('public.element_objects') is not null
     and to_regprocedure('alcon_internal.work_import_object_in_space(uuid, uuid)') is not null then
    execute $f$
      create or replace function public.import_existing_work(p_space_id uuid, p_batch_id uuid, p_object_id uuid, p_domain_id uuid, p_project_name text, p_rows jsonb)
      returns jsonb language plpgsql set search_path = '' as $b$
      declare
        v_user uuid := auth.uid();
        v_request jsonb;
        v_receipt public.work_import_receipts%rowtype;
        v_object uuid := p_object_id;
        v_domain uuid := p_domain_id;
        v_row jsonb;
        v_id uuid;
        v_worker uuid;
        v_date date;
        v_description text;
        v_source jsonb;
        v_result jsonb := '[]'::jsonb;
        v_count integer;
      begin
        if v_user is null or p_batch_id is null or p_space_id is null or not public.is_activity_space_member(p_space_id) then
          raise exception 'An authenticated Space member is required' using errcode = '42501';
        end if;
        if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Import rows must be an array'; end if;
        v_count := jsonb_array_length(p_rows);
        if v_count < 1 or v_count > 100 or octet_length(p_rows::text) > 1048576 then
          raise exception 'Import 1 to 100 Elements, up to 1 MB, at a time';
        end if;
        if (select count(distinct r->>'rowKey') from jsonb_array_elements(p_rows) r) <> v_count then
          raise exception 'Every import row must have a unique key';
        end if;
        v_request := jsonb_build_object('space',p_space_id,'object',p_object_id,'domain',p_domain_id,
          'name',p_project_name,'rows',p_rows);
        perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_batch_id::text, 0));
        select * into v_receipt from public.work_import_receipts where id = p_batch_id;
        if found then
          if v_receipt.outcome='abandoned' then
            raise exception 'This import was closed before any work was saved. Start a new import.' using errcode='P2001';
          end if;
          if v_receipt.created_by <> v_user or v_receipt.request <> v_request then
            raise exception 'This import was already used with different contents';
          end if;
          if not alcon_internal.work_import_object_in_space(v_receipt.object_id,p_space_id) or exists (
            select 1 from jsonb_array_elements(v_receipt.result) r
            where not exists (select 1 from public.elements e
              where e.id = (r->>'elementId')::uuid and e.object_id = v_receipt.object_id)
          ) then raise exception 'Imported work has been removed or is no longer visible. Open the project to check it.' using errcode='P2002'; end if;
          return jsonb_build_object('saved',v_receipt.result,'objectId',v_receipt.object_id,'replayed',true);
        end if;

        if v_object is not null then
          if not alcon_internal.work_import_object_in_space(v_object,p_space_id) then
            raise exception 'Choose a visible project in this Space' using errcode = '42501';
          end if;
        else
          if nullif(btrim(p_project_name),'') is null or length(p_project_name) > 160 then
            raise exception 'Give this project a name of up to 160 characters';
          end if;
          if v_domain is not null then
            perform 1 from public.domains d where d.id=v_domain and d.activity_space_id=p_space_id and public.user_can_see_domain(d.id);
            if not found then raise exception 'Choose a visible Domain in this Space' using errcode = '42501'; end if;
          else
            -- The first real project creates its storage container. Users need
            -- not learn the Domain/Object taxonomy before bringing their work.
            insert into public.domains(name,user_id,activity_space_id,privacy)
              values ('General',v_user,p_space_id,'workspace') returning id into v_domain;
            insert into public.domain_members(domain_id,user_id,role) values(v_domain,v_user,'owner');
          end if;
          insert into public.objects(name,domain_id,user_id) values(btrim(p_project_name),v_domain,v_user) returning id into v_object;
          insert into public.object_members(object_id,user_id,role) values(v_object,v_user,'owner');
          -- The primary FK already establishes this home. Its duplicate junction
          -- is writable only by the Domain creator under the existing policy.
          if exists(select 1 from public.domains d where d.id=v_domain and d.user_id=v_user) then
            insert into public.object_domains(object_id,domain_id) values(v_object,v_domain) on conflict do nothing;
          end if;
        end if;

        for v_row in select value from jsonb_array_elements(p_rows) loop
          if jsonb_typeof(v_row) <> 'object' or nullif(btrim(v_row->>'rowKey'),'') is null
            or length(v_row->>'rowKey') > 120 or nullif(btrim(v_row->>'title'),'') is null
            or jsonb_typeof(v_row->'title') <> 'string' or jsonb_typeof(v_row->'rowKey') <> 'string'
            or length(v_row->>'title') > 500 or length(coalesce(v_row->>'description','')) > 20000
            or (v_row->>'status') is null or (v_row->>'status') not in ('backlog','todo','in_progress','review','done','blocked','cancelled') then
            raise exception 'Invalid title, status, or description in import row %', v_row->>'sourceRow';
          end if;
          v_date := null;
          if nullif(v_row->>'due_date','') is not null then
            if (v_row->>'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Use unambiguous ISO dates'; end if;
            v_date := (v_row->>'due_date')::date;
            if to_char(v_date,'YYYY-MM-DD') <> v_row->>'due_date' then raise exception 'Invalid date'; end if;
          end if;
          v_worker := nullif(v_row->>'worker_id','')::uuid;

          v_source := coalesce(v_row->'source','{}'::jsonb);
          if jsonb_typeof(v_source) <> 'object' or octet_length(v_source::text)>8000 then raise exception 'Invalid import source'; end if;
          v_description := nullif(concat_ws(E'\n\n', nullif(v_row->>'description',''),
            'Imported record — not synchronized with the source.' || E'\n'
            || concat_ws(E'\n',
              case when nullif(v_source->>'id','') is not null then 'Source ID: ' || (v_source->>'id') end,
              case when nullif(coalesce(v_source->>'original_url',v_source->>'url'),'') is not null then 'Source URL: ' || coalesce(v_source->>'original_url',v_source->>'url') end,
              case when nullif(v_source->>'status','') is not null then 'Source status: ' || (v_source->>'status') end,
              case when nullif(v_source->>'assignee','') is not null then 'Source assignee: ' || (v_source->>'assignee') end,
              case when nullif(v_source->>'due_date','') is not null then 'Source due date: ' || (v_source->>'due_date') end
            )), '');
          insert into public.elements(object_id,title,description,status,due_date,progress,owner_id,is_approval,approval_state)
            values(v_object,btrim(v_row->>'title'),v_description,v_row->>'status',v_date,
              case when v_row->>'status'='done' then 100 else null end,null,false,null) returning id into v_id;
          insert into public.element_objects(element_id,object_id) values(v_id,v_object) on conflict do nothing;
          if v_worker is not null then
            -- Checked against the Element just written, like every other
            -- assignment; a refusal rolls back the whole import.
            if not public.worker_assignable(v_worker, v_id) then
              raise exception 'An assignee is no longer available in this Space' using errcode='42501';
            end if;
            insert into public.element_assignees(element_id,worker_id,role) values(v_id,v_worker,'assignee');
          end if;
          v_result := v_result || jsonb_build_array(jsonb_build_object('rowKey',v_row->>'rowKey','elementId',v_id));
        end loop;
        insert into public.work_import_receipts(id,created_by,activity_space_id,object_id,request,result)
          values(p_batch_id,v_user,p_space_id,v_object,v_request,v_result);
        return jsonb_build_object('saved',v_result,'objectId',v_object,'replayed',false);
      end;
      $b$
    $f$;
  end if;
end $$;
