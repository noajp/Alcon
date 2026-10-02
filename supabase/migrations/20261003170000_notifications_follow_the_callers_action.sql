-- Notifications follow the caller's own action and reach only people who can
-- see the Element (ELE_AI-099).
--
-- notifications_insert_any let any signed-in browser write a notification for
-- any recipient, with any title, body and element_id. Every other writer is
-- already server-side: the status / comment / mention / due / review triggers
-- and generate_* jobs are SECURITY DEFINER, and run-agent uses the service
-- role. The browser wrote rows for four things:
--
--   mention          duplicated notify_element_comment, which already sends
--                    'mention' rows from element_comments.mentions — the
--                    browser call is removed, nothing replaces it.
--   assigned         public.notify_about_element(element, 'assigned', worker)
--   status_change    public.notify_about_element(element, 'status_change')
--   approval_decided public.notify_about_element(element, 'approval_decided')
--
-- The RPC takes no recipients, title or body from the client. It looks for the
-- caller's own proof row, written within the last ten minutes and not in the
-- future, that still matches the Element:
--
--   assigned         the element_assignees row for that Worker.
--   status_change    a 'status' row in element_activity by the caller whose
--                    detail ends in "→ <current status>". Only the SECURITY
--                    DEFINER trigger record_element_status_change writes
--                    'status' rows now (element_activity_insert refuses that
--                    kind from browsers), so its created_at is the server's.
--   approval_decided an element_approvals row by the caller whose state is the
--                    Element's current approval_state. element_approvals
--                    becomes read-if-you-see-the-Element and insert-as-yourself
--                    (it was read / write / delete for anyone signed in), so
--                    nobody else's rows can stand in for, or crowd out, the
--                    caller's.
--
-- Only rows by the caller count, so a row someone else parks in the future
-- cannot block a real notification. The recipients come from the Element (the
-- user behind that Worker / behind every assigned Worker), minus the caller and
-- anyone who cannot see the Element (user_can_see_element_as); the actor is
-- auth.uid() and the caller's profile name, and the text is written here.
-- 'done' and 'blocked' are left to notify_element_status so the assignees get
-- one row, not two. A recipient who already has this kind of notification from
-- the caller about this Element, dated at or after the proof row, gets nothing
-- more: a repeat call is silent, a genuinely new change (a new proof row) is
-- announced.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.notifications') is null
     or to_regclass('public.elements') is null
     or to_regclass('public.element_assignees') is null
     or to_regclass('public.element_approvals') is null
     or to_regclass('public.element_activity') is null
     or to_regclass('public.workers') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('alcon_internal.user_can_see_element_as(uuid, uuid)') is null then
    raise notice 'notifications_follow_the_callers_action skipped: base schema not present';
    return;
  end if;

  execute $f$
    create or replace function public.notify_about_element(
      p_element_id uuid,
      p_kind text,
      p_worker_id uuid default null
    )
    returns integer
    language plpgsql
    volatile
    security definer
    set search_path = ''
    as $b$
    declare
      v_actor   uuid := auth.uid();
      v_window  interval := interval '10 minutes';
      v_name    text;
      v_element public.elements%rowtype;
      v_title   text;
      v_body    text;
      v_proof   timestamptz;
      v_state   text;
      v_note    text;
      v_to      uuid[];
      v_count   integer := 0;
    begin
      if v_actor is null then
        raise exception 'notify_about_element: not authenticated' using errcode = '42501';
      end if;
      if p_kind is null or p_kind not in ('assigned', 'status_change', 'approval_decided') then
        raise exception 'notify_about_element: kind % is not sent from the app', p_kind
          using errcode = '22023';
      end if;
      if p_element_id is null or not public.user_can_see_element(p_element_id) then
        raise exception 'notify_about_element: element not visible' using errcode = '42501';
      end if;

      select * into v_element from public.elements e where e.id = p_element_id;
      v_element.title := coalesce(nullif(btrim(v_element.title), ''), 'Untitled');

      select coalesce(nullif(btrim(p.display_name), ''), nullif(split_part(u.email, '@', 1), ''), 'Someone')
        into v_name
        from auth.users u left join public.profiles p on p.id = u.id
       where u.id = v_actor;
      v_name := left(coalesce(v_name, 'Someone'), 80);

      if p_kind = 'assigned' then
        -- The Worker is on this Element, put there within the window.
        select max(ea.assigned_at) into v_proof from public.element_assignees ea
         where ea.element_id = p_element_id and ea.worker_id = p_worker_id
           and ea.assigned_at > now() - v_window and ea.assigned_at <= now();
        if p_worker_id is null or v_proof is null then
          raise exception 'notify_about_element: no recent assignment of that worker'
            using errcode = '42501';
        end if;
        select array_agg(w.user_id) into v_to from public.workers w
         where w.id = p_worker_id and w.user_id is not null;
        v_title := v_name || ' assigned you to "' || v_element.title || '"';
        v_body := null;

      elsif p_kind = 'status_change' then
        -- The caller moved the Element to the status it has now.
        select max(a.created_at) into v_proof from public.element_activity a
         where a.element_id = p_element_id and a.kind = 'status' and a.actor_id = v_actor
           and a.created_at > now() - v_window and a.created_at <= now()
           and right(a.detail, char_length(' → ' || coalesce(v_element.status, '—')))
               = ' → ' || coalesce(v_element.status, '—');
        if v_proof is null then
          raise exception 'notify_about_element: no recent status change by the caller'
            using errcode = '42501';
        end if;
        -- notify_element_status already tells everyone about done / blocked.
        if v_element.status in ('done', 'blocked') then
          return 0;
        end if;
        select array_agg(w.user_id) into v_to from public.element_assignees ea
          join public.workers w on w.id = ea.worker_id
         where ea.element_id = p_element_id and w.user_id is not null;
        v_title := v_name || ' changed status to ' || replace(coalesce(v_element.status, '—'), '_', ' ');
        v_body := v_element.title;

      else -- approval_decided
        -- The caller made the decision the Element now carries.
        select ap.decided_at, ap.state, ap.note into v_proof, v_state, v_note
          from public.element_approvals ap
         where ap.element_id = p_element_id and ap.approver_id = v_actor
           and ap.state = v_element.approval_state
           and ap.decided_at > now() - v_window and ap.decided_at <= now()
         order by ap.decided_at desc
         limit 1;
        if v_proof is null then
          raise exception 'notify_about_element: no recent decision by the caller'
            using errcode = '42501';
        end if;
        select array_agg(w.user_id) into v_to from public.element_assignees ea
          join public.workers w on w.id = ea.worker_id
         where ea.element_id = p_element_id and w.user_id is not null;
        v_title := v_name || ' ' || replace(v_state, '_', ' ') || ' "' || v_element.title || '"';
        v_body := nullif(btrim(v_note), '');
      end if;

      v_title := left(v_title, 300);
      v_body := left(v_body, 1000);

      insert into public.notifications (recipient_id, actor_id, actor_name, kind, element_id, title, body)
      select r.user_id, v_actor, v_name, p_kind, p_element_id, v_title, v_body
        from (select distinct t.user_id from unnest(coalesce(v_to, '{}'::uuid[])) as t(user_id)
               where t.user_id is not null and t.user_id <> v_actor
               limit 50) r
       where alcon_internal.user_can_see_element_as(p_element_id, r.user_id)
         -- Already announced for this proof row (or a later one): stay silent.
         and not exists (
           select 1 from public.notifications n
            where n.recipient_id = r.user_id and n.element_id = p_element_id
              and n.kind = p_kind and n.actor_id = v_actor
              and n.created_at >= v_proof);
      get diagnostics v_count = row_count;
      return v_count;
    end
    $b$
  $f$;

  execute 'revoke all on function public.notify_about_element(uuid, text, uuid) from public, anon';
  execute 'grant execute on function public.notify_about_element(uuid, text, uuid) to authenticated';

  -- Browsers no longer write notifications directly; recipients still read,
  -- update and delete their own (notifications_*_own).
  execute 'drop policy if exists notifications_insert_any on public.notifications';

  -- 'status' rows come only from record_element_status_change (SECURITY
  -- DEFINER); the app logs every other kind itself.
  execute 'drop policy if exists element_activity_insert on public.element_activity';
  execute $p$
    create policy element_activity_insert on public.element_activity for insert
      with check (auth.uid() is not null and public.user_can_see_element(element_id) and kind <> 'status')
  $p$;

  -- Approvals: read where the Element is visible, decide only as yourself, no
  -- browser edits or deletes (the app only inserts and reads).
  execute 'drop policy if exists element_approvals_rw on public.element_approvals';
  execute 'drop policy if exists element_approvals_select on public.element_approvals';
  execute 'drop policy if exists element_approvals_insert on public.element_approvals';
  execute $p$
    create policy element_approvals_select on public.element_approvals for select to authenticated
      using (public.user_can_see_element(element_id))
  $p$;
  execute $p$
    create policy element_approvals_insert on public.element_approvals for insert to authenticated
      with check (approver_id = auth.uid() and public.user_can_see_element(element_id))
  $p$;
end $$;
