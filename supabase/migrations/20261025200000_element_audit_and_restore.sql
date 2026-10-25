-- An Element's record outlives it, and its changes are written by the server
-- (ELE_AI-140).
--
-- Deleting an Element keeps it: just before the row goes, the database keeps a
-- snapshot of it and everything that hangs off it — sub-elements, people,
-- homes, comments, reactions, history, approvals, custom values, links — in
-- element_deletions. Whoever could see it there can list it and put it back
-- with restore_element(), which brings the same Element (same id, same
-- display id) back with its history, and records that it was deleted and
-- restored. Snapshots are kept; nothing purges them.
--
-- Changes are recorded by triggers, not by the screen: title, description,
-- priority, start and due dates, estimate, a move to another Object, and
-- people added or removed (status was already). The app no longer writes
-- those kinds itself and cannot forge them.
--
-- While a restore puts rows back, `alcon.restoring` is on, and triggers that
-- would treat the old rows as new events — notifications, server stamps,
-- approval guards, change history — stand aside.
do $$
begin
  if to_regclass('public.elements') is null
     or to_regclass('public.element_activity') is null
     or to_regclass('public.element_assignees') is null
     or to_regclass('public.element_comments') is null
     or to_regclass('public.element_approvals') is null
     or to_regclass('public.subelements') is null
     or to_regclass('public.element_objects') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_can_see_object(uuid)') is null then
    raise notice 'element audit and restore skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create or replace function public.alcon_restoring() returns boolean
  language sql stable set search_path = public as $fn$
    select coalesce(current_setting('alcon.restoring', true), '') = 'on';
  $fn$;

  create table if not exists public.element_deletions (
    id uuid primary key default gen_random_uuid(),
    element_id uuid not null,
    object_id uuid,
    owner_id uuid,
    title text not null,
    display_id text,
    snapshot jsonb not null,
    deleted_by uuid default auth.uid(),
    deleted_by_name text,
    deleted_at timestamptz not null default now()
  );
  create index if not exists element_deletions_object on public.element_deletions (object_id, deleted_at desc);
  create index if not exists element_deletions_element on public.element_deletions (element_id);
  alter table public.element_deletions enable row level security;
  drop policy if exists element_deletions_read on public.element_deletions;
  -- Readable by whoever could see it where it lived, its owner, or who deleted it.
  create policy element_deletions_read on public.element_deletions for select to authenticated
    using (deleted_by = auth.uid() or owner_id = auth.uid() or (object_id is not null and public.user_can_see_object(object_id)));
  -- The list shows what was deleted, when and by whom; the snapshot itself —
  -- which holds rows its readers may not all have seen — is read only by restore.
  revoke all on public.element_deletions from anon, authenticated;
  grant select (id, element_id, object_id, owner_id, title, display_id, deleted_by, deleted_by_name, deleted_at)
    on public.element_deletions to authenticated;

  create or replace function public.snapshot_element_before_delete() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_name text;
    v_snapshot jsonb;
  begin
    if public.alcon_restoring() then return old; end if;
    select nullif(btrim(p.display_name), '') into v_name from public.profiles p where p.id = auth.uid();
    v_snapshot := jsonb_build_object(
      'element', to_jsonb(old),
      'subelements', coalesce((select jsonb_agg(to_jsonb(t)) from public.subelements t where t.element_id = old.id), '[]'::jsonb),
      'element_assignees', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_assignees t where t.element_id = old.id), '[]'::jsonb),
      'element_objects', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_objects t where t.element_id = old.id), '[]'::jsonb),
      'element_comments', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at) from public.element_comments t where t.element_id = old.id), '[]'::jsonb),
      'element_reactions', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_reactions t where t.element_id = old.id), '[]'::jsonb),
      'element_activity', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_activity t where t.element_id = old.id), '[]'::jsonb),
      'element_approvals', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_approvals t where t.element_id = old.id), '[]'::jsonb),
      'custom_column_values', coalesce((select jsonb_agg(to_jsonb(t)) from public.custom_column_values t where t.element_id = old.id), '[]'::jsonb),
      'element_edges', coalesce((select jsonb_agg(to_jsonb(t)) from public.element_edges t where t.from_element = old.id or t.to_element = old.id), '[]'::jsonb),
      'crm_element_links', case when to_regclass('public.crm_element_links') is null then '[]'::jsonb
        else coalesce((select jsonb_agg(to_jsonb(t)) from public.crm_element_links t where t.element_id = old.id), '[]'::jsonb) end
    );
    insert into public.element_deletions (element_id, object_id, owner_id, title, display_id, snapshot, deleted_by, deleted_by_name)
    values (old.id, old.object_id, old.owner_id, coalesce(nullif(btrim(old.title), ''), 'Untitled'), old.display_id, v_snapshot, auth.uid(), v_name);
    return old;
  end $fn$;
  revoke all on function public.snapshot_element_before_delete() from public, anon, authenticated;
  drop trigger if exists elements_snapshot_before_delete on public.elements;
  create trigger elements_snapshot_before_delete before delete on public.elements
    for each row execute function public.snapshot_element_before_delete();

  -- Put a deleted Element back, with what hung off it. Rows that can no longer
  -- go back (a Worker since removed, an edge to an Element still deleted) are
  -- left out; the Element itself comes back or nothing does.
  create or replace function public.restore_element(p_deletion uuid) returns uuid
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_del public.element_deletions%rowtype;
    v_el public.elements%rowtype;
    v_table text;
    v_name text;
    v_row jsonb;
    v_home boolean;
  begin
    select * into v_del from public.element_deletions where id = p_deletion;
    if not found or auth.uid() is null then
      raise exception 'This deleted Element is not yours to restore' using errcode = '42501';
    end if;
    v_home := v_del.object_id is not null and exists (select 1 from public.objects where id = v_del.object_id);
    -- Back into its Object: whoever can see that Object now. Its Object gone
    -- (or none): whoever deleted it or owned it, as their own Element.
    if (v_home and not public.user_can_see_object(v_del.object_id))
       or (not v_home and not (coalesce(v_del.deleted_by = auth.uid(), false) or coalesce(v_del.owner_id = auth.uid(), false))) then
      raise exception 'This deleted Element is not yours to restore' using errcode = '42501';
    end if;
    if exists (select 1 from public.elements where id = v_del.element_id) then
      raise exception 'This Element is already back' using errcode = '23505';
    end if;
    perform set_config('alcon.restoring', 'on', true);
    v_el := jsonb_populate_record(null::public.elements, v_del.snapshot->'element');
    if not v_home then
      v_el.object_id := null;
      v_el.owner_id := auth.uid();
    end if;
    -- Its number was given to a newer Element meanwhile: it takes the next one.
    if exists (select 1 from public.elements e where e.object_id is not distinct from v_el.object_id and e.seq_number = v_el.seq_number) then
      v_el.seq_number := null;
    end if;
    insert into public.elements select v_el.*;
    foreach v_table in array array['subelements', 'element_objects', 'element_assignees', 'element_comments', 'element_reactions',
                                   'element_activity', 'element_approvals', 'custom_column_values', 'element_edges', 'crm_element_links'] loop
      if to_regclass('public.' || v_table) is null or jsonb_array_length(coalesce(v_del.snapshot->v_table, '[]'::jsonb)) = 0 then continue; end if;
      begin
        execute format('insert into public.%1$I select * from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing', v_table)
          using v_del.snapshot->v_table;
      exception when others then
        -- Row by row, in the order they were written: keep what can go back.
        for v_row in select value from jsonb_array_elements(v_del.snapshot->v_table) loop
          begin
            execute format('insert into public.%1$I select * from jsonb_populate_record(null::public.%1$I, $1) on conflict do nothing', v_table) using v_row;
          exception when others then null;
          end;
        end loop;
      end;
    end loop;
    select nullif(btrim(p.display_name), '') into v_name from public.profiles p where p.id = auth.uid();
    -- The deletion at the time it happened, then the restore now.
    insert into public.element_activity (element_id, kind, detail, author, actor_id, created_at)
    values (v_del.element_id, 'deleted', 'Deleted' || coalesce(' by ' || v_del.deleted_by_name, ''), coalesce(v_del.deleted_by_name, 'System'), v_del.deleted_by, v_del.deleted_at);
    perform set_config('alcon.restoring', '', true);
    insert into public.element_activity (element_id, kind, detail, author, actor_id, created_at)
    values (v_del.element_id, 'restored', 'Restored', coalesce(v_name, 'Member'), auth.uid(), clock_timestamp());
    delete from public.element_deletions where id = p_deletion;
    return v_del.element_id;
  end $fn$;
  revoke all on function public.restore_element(uuid) from public, anon;
  grant execute on function public.restore_element(uuid) to authenticated;

  -- What changed, written by the server.
  create or replace function public.record_element_changes() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_author text;
    v_rows text[][] := array[]::text[][];
    v_row text[];
    v_object text;
  begin
    if public.alcon_restoring() then return new; end if;
    if new.title is distinct from old.title then
      v_rows := v_rows || array[['renamed', 'Renamed to “' || coalesce(new.title, '') || '”']];
    end if;
    if new.description is distinct from old.description then
      v_rows := v_rows || array[['description', case when coalesce(btrim(new.description), '') = '' then 'Cleared description' else 'Updated description' end]];
    end if;
    if new.priority is distinct from old.priority then
      v_rows := v_rows || array[['priority', 'Priority → ' || coalesce(initcap(new.priority), 'none')]];
    end if;
    if new.due_date is distinct from old.due_date then
      v_rows := v_rows || array[['due', coalesce('Due date → ' || new.due_date::text, 'Cleared due date')]];
    end if;
    if new.start_date is distinct from old.start_date then
      v_rows := v_rows || array[['due', coalesce('Start date → ' || new.start_date::text, 'Cleared start date')]];
    end if;
    if new.estimated_hours is distinct from old.estimated_hours then
      v_rows := v_rows || array[['estimate', coalesce('Estimate → ' || trim_scale(new.estimated_hours::numeric)::text || 'h', 'Cleared estimate')]];
    end if;
    if new.object_id is distinct from old.object_id then
      select o.name into v_object from public.objects o where o.id = new.object_id;
      v_rows := v_rows || array[['moved', coalesce('Moved to “' || v_object || '”', 'Moved out of its Object')]];
    end if;
    if coalesce(array_length(v_rows, 1), 0) = 0 then return new; end if;
    select nullif(btrim(p.display_name), '') into v_author from public.profiles p where p.id = auth.uid();
    foreach v_row slice 1 in array v_rows loop
      insert into public.element_activity (element_id, kind, detail, author, actor_id, created_at)
      values (new.id, v_row[1], v_row[2], coalesce(v_author, 'System'), auth.uid(), clock_timestamp());
    end loop;
    return new;
  end $fn$;
  revoke all on function public.record_element_changes() from public, anon, authenticated;
  drop trigger if exists elements_record_changes on public.elements;
  create trigger elements_record_changes after update of title, description, priority, due_date, start_date, estimated_hours, object_id on public.elements
    for each row execute function public.record_element_changes();

  create or replace function public.record_element_people() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_author text;
    v_worker text;
    v_row public.element_assignees%rowtype := coalesce(new, old);
    v_role text;
  begin
    if public.alcon_restoring() then return v_row; end if;
    -- The Element itself going: its people go with it, nothing to write.
    if not exists (select 1 from public.elements e where e.id = v_row.element_id) then return v_row; end if;
    select w.name into v_worker from public.workers w where w.id = v_row.worker_id;
    v_role := case v_row.role when 'reviewer' then ' as reviewer' when 'collaborator' then ' as collaborator' else '' end;
    select nullif(btrim(p.display_name), '') into v_author from public.profiles p where p.id = auth.uid();
    insert into public.element_activity (element_id, kind, detail, author, actor_id)
    values (v_row.element_id,
      case when tg_op = 'INSERT' then 'assigned' else 'unassigned' end,
      case when tg_op = 'INSERT' then 'Assigned ' else 'Unassigned ' end || coalesce(v_worker, 'someone') || v_role,
      coalesce(v_author, 'System'), auth.uid());
    return v_row;
  end $fn$;
  revoke all on function public.record_element_people() from public, anon, authenticated;
  drop trigger if exists element_assignees_record on public.element_assignees;
  create trigger element_assignees_record after insert or delete on public.element_assignees
    for each row execute function public.record_element_people();

  -- The kinds the server writes are the server's alone.
  drop policy if exists element_activity_insert on public.element_activity;
  create policy element_activity_insert on public.element_activity for insert to authenticated
    with check (auth.uid() is not null and public.user_can_see_element(element_id)
      and kind not in ('status', 'renamed', 'description', 'priority', 'due', 'estimate', 'moved', 'assigned', 'unassigned', 'deleted', 'restored'));

  -- Old rows coming back are not new events.
  create or replace function public.element_approvals_stamp()
  returns trigger language plpgsql security definer set search_path = '' as $b$
  begin
    if auth.uid() is null or public.alcon_restoring() then
      return new;
    end if;
    new.decided_at := now();
    new.approver_name := coalesce(
      (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = auth.uid()),
      nullif(btrim(new.approver_name), ''));
    return new;
  end
  $b$;

  create or replace function public.notify_element_comment()
  returns trigger language plpgsql security definer set search_path = public as $fn$
    declare
      v_element text;
      v_author  text := coalesce(nullif(new.author_name, ''), 'Someone');
    begin
      if public.alcon_restoring() then return new; end if;
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
  $fn$;


  -- The approval guards let a restore put an Element's own rows back as they were.
  create or replace function public.elements_guard_approval() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if auth.uid() is null or public.alcon_restoring() then return new; end if;
    if tg_op = 'INSERT' then
      -- A new Element can ask for approval, not arrive approved.
      new.approval_state := case when new.is_approval then 'pending' end;
      return new;
    end if;
    -- Turning the step on starts over; turning it off takes the state with it.
    if coalesce(new.is_approval, false) and not coalesce(old.is_approval, false) then
      new.approval_state := 'pending';
    elsif not coalesce(new.is_approval, false) then
      if coalesce(old.is_approval, false) and not public.user_can_manage_approval(new.id) then
        raise exception 'Only an owner or admin of its Domain can take the approval step off' using errcode = '42501';
      end if;
      new.approval_state := null;
    elsif new.approval_state is distinct from old.approval_state and coalesce(new.approval_state, 'pending') <> 'pending'
          and not public.user_can_decide_approval(new.id) then
      raise exception 'Only a reviewer, or an owner or admin of its Domain who is not working on it, can decide this approval'
        using errcode = '42501';
    end if;
    -- Moving an approval Element out of its Objects, or making it someone's
    -- own, would change who manages it: only a manager may.
    if coalesce(old.is_approval, false)
       and (new.object_id is distinct from old.object_id or new.owner_id is distinct from old.owner_id)
       and not public.user_can_manage_approval(old.id) then
      raise exception 'Only an owner or admin of its Domain can move an Element that needs approval' using errcode = '42501';
    end if;
    -- Done needs the approval, however the status is set.
    if new.status = 'done' and old.status is distinct from 'done'
       and coalesce(new.is_approval, false) and new.approval_state is distinct from 'approved' then
      raise exception 'This Element needs approval before it can be marked done.' using errcode = '22023';
    end if;
    return new;
  end $fn$;

  create or replace function public.element_assignees_guard_reviewer() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if auth.uid() is null or public.alcon_restoring() then return coalesce(new, old); end if;
    if tg_op = 'DELETE' then
      -- The Element or the Worker itself going: its rows go with it.
      if old.role = 'reviewer' and exists (select 1 from public.elements e where e.id = old.element_id)
         and exists (select 1 from public.workers w where w.id = old.worker_id)
         and not public.user_can_manage_approval(old.element_id) then
        raise exception 'Only an owner or admin of its Domain can remove a reviewer' using errcode = '42501';
      end if;
      return old;
    end if;
    -- Nobody steps from doing the work into reviewing it themselves.
    if new.role = 'reviewer' and exists (select 1 from public.workers w where w.id = new.worker_id and w.user_id = auth.uid())
       and (tg_op = 'INSERT' or old.role <> 'reviewer') and exists (
         select 1 from public.element_assignees ea join public.workers w on w.id = ea.worker_id
         where ea.element_id = new.element_id and w.user_id = auth.uid() and ea.role in ('assignee', 'collaborator') and ea.id <> new.id) then
      raise exception 'Someone working on an Element cannot become its reviewer' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.role in ('assignee', 'collaborator') and new.role = 'reviewer'
       and exists (select 1 from public.workers w where w.id = new.worker_id and w.user_id = auth.uid()) then
      raise exception 'Someone working on an Element cannot become its reviewer' using errcode = '42501';
    end if;
    if new.role = 'reviewer' and not public.user_can_manage_approval(new.element_id) then
      raise exception 'Only an owner or admin of its Domain can name or change reviewers' using errcode = '42501';
    end if;
    -- A reviewer row changed in any way (role, person, Element) is a reviewer
    -- removed where it was: that needs the manager there too.
    if tg_op = 'UPDATE' and old.role = 'reviewer'
       and (new.role <> 'reviewer' or new.worker_id is distinct from old.worker_id or new.element_id is distinct from old.element_id)
       and not public.user_can_manage_approval(old.element_id) then
      raise exception 'Only an owner or admin of its Domain can name or change reviewers' using errcode = '42501';
    end if;
    return new;
  end $fn$;

  -- A restored history row keeps who wrote it.
  create or replace function public.stamp_element_activity() returns trigger
  language plpgsql security definer set search_path = public as $fn$
    declare
      v_actor uuid := auth.uid();
      v_name text;
    begin
      if public.alcon_restoring() then return new; end if;
      if v_actor is not null then
        new.actor_id := v_actor;
        select p.display_name into v_name from profiles p where p.id = v_actor;
        if nullif(v_name, '') is not null then
          new.author := v_name;
        end if;
      end if;
      return new;
    end
  $fn$;

  -- A restored comment does not revive the lease of the session that wrote it.
  create or replace function public.extend_element_lease_on_comment() returns trigger
  language plpgsql security definer set search_path = public as $fn$
    begin
      if new.holder is null or public.alcon_restoring() then
        return new;
      end if;
      update elements
         set claim_expires_at = now() + element_lease_ttl()
       where id = new.element_id
         and claimed_by = new.holder;
      return new;
    end
  $fn$;
  $ddl$;
end $$;
