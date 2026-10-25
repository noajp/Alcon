-- Who may decide an approval (ELE_AI-139). Seeing an Element is not enough:
-- an approval is a check by someone other than the people doing the work.
--
-- Who manages an Element's approvals (names its reviewers, takes the step
-- off): an owner or admin of a Domain the Element lives in; for an Object in
-- no Domain, the Object's owner; for a personal Element, its owner; for an
-- Element with no home and no owner, anyone who can see it.
--
-- Who decides: the Element's reviewers when it names any, otherwise those
-- managers — and never someone assigned to or collaborating on it.
--
-- Anyone who can edit an Element can still ask for approval (turn the step on,
-- or send it back to pending). Turning the step on always starts at pending;
-- an Element that needs approval cannot be marked done until it is approved.
do $$
begin
  if to_regclass('public.element_approvals') is null
     or to_regclass('public.element_assignees') is null
     or to_regclass('public.element_objects') is null
     or to_regclass('public.object_domains') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null
     or to_regprocedure('public.user_has_domain_role(uuid, text[])') is null then
    raise notice 'approval separation of duties skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create or replace function public.user_can_manage_approval(p_element uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    with homes as (
      select e.object_id from public.elements e where e.id = p_element and e.object_id is not null
      union
      select eo.object_id from public.element_objects eo where eo.element_id = p_element
    ),
    domains as (
      select o.domain_id from homes h join public.objects o on o.id = h.object_id where o.domain_id is not null
      union
      select od.domain_id from homes h join public.object_domains od on od.object_id = h.object_id
    )
    select auth.uid() is not null and public.user_can_see_element(p_element) and case
      when exists (select 1 from domains)
        then exists (select 1 from domains d where public.user_has_domain_role(d.domain_id, array['owner', 'admin']))
      when exists (select 1 from homes)
        then exists (select 1 from homes h join public.objects o on o.id = h.object_id where o.user_id = auth.uid())
      when exists (select 1 from public.elements e where e.id = p_element and e.owner_id is not null)
        then exists (select 1 from public.elements e where e.id = p_element and e.owner_id = auth.uid())
      else true
    end;
  $fn$;
  revoke all on function public.user_can_manage_approval(uuid) from public, anon;
  grant execute on function public.user_can_manage_approval(uuid) to authenticated;

  create or replace function public.user_can_decide_approval(p_element uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    with me as (
      select w.id from public.workers w where w.user_id = auth.uid() and w.type = 'human'
    )
    select auth.uid() is not null
      and public.user_can_see_element(p_element)
      -- Never the people doing the work.
      and not exists (select 1 from public.element_assignees ea where ea.element_id = p_element and ea.role in ('assignee', 'collaborator') and ea.worker_id in (select id from me))
      and case
        when exists (select 1 from public.element_assignees ea where ea.element_id = p_element and ea.role = 'reviewer')
          then exists (select 1 from public.element_assignees ea where ea.element_id = p_element and ea.role = 'reviewer' and ea.worker_id in (select id from me))
        else public.user_can_manage_approval(p_element)
      end;
  $fn$;
  revoke all on function public.user_can_decide_approval(uuid) from public, anon;
  grant execute on function public.user_can_decide_approval(uuid) to authenticated;

  drop policy if exists element_approvals_insert on public.element_approvals;
  create policy element_approvals_insert on public.element_approvals for insert to authenticated
    with check (approver_id = auth.uid() and public.user_can_see_element(element_id) and public.user_can_decide_approval(element_id));

  -- The Element's own approval columns follow the same rule. The decision
  -- trigger (sync_element_approval_state) runs as the approver, who passes it.
  create or replace function public.elements_guard_approval() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if auth.uid() is null then return new; end if;
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
    -- Done needs the approval, however the status is set.
    if new.status = 'done' and old.status is distinct from 'done'
       and coalesce(new.is_approval, false) and new.approval_state is distinct from 'approved' then
      raise exception 'This Element needs approval before it can be marked done.' using errcode = '22023';
    end if;
    return new;
  end $fn$;
  revoke all on function public.elements_guard_approval() from public, anon, authenticated;
  drop trigger if exists elements_guard_approval on public.elements;
  create trigger elements_guard_approval before insert or update of is_approval, approval_state, status on public.elements
    for each row execute function public.elements_guard_approval();

  -- Reviewers are named by those who manage the Element's approvals; nobody
  -- can make themselves a reviewer, and the people doing the work cannot step
  -- over into reviewing it.
  create or replace function public.element_assignees_guard_reviewer() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    v_element uuid := coalesce(new.element_id, old.element_id);
  begin
    if auth.uid() is null then return coalesce(new, old); end if;
    if tg_op = 'DELETE' then
      -- The Element itself going: its people go with it.
      if old.role = 'reviewer' and exists (select 1 from public.elements e where e.id = old.element_id)
         and not public.user_can_manage_approval(old.element_id) then
        raise exception 'Only an owner or admin of its Domain can remove a reviewer' using errcode = '42501';
      end if;
      return old;
    end if;
    if tg_op = 'UPDATE' and old.role in ('assignee', 'collaborator') and new.role = 'reviewer' then
      raise exception 'Someone working on an Element cannot become its reviewer' using errcode = '42501';
    end if;
    if (new.role = 'reviewer' or (tg_op = 'UPDATE' and old.role = 'reviewer' and new.role <> 'reviewer'))
       and not public.user_can_manage_approval(v_element) then
      raise exception 'Only an owner or admin of its Domain can name or change reviewers' using errcode = '42501';
    end if;
    return new;
  end $fn$;
  revoke all on function public.element_assignees_guard_reviewer() from public, anon, authenticated;
  drop trigger if exists element_assignees_guard_reviewer on public.element_assignees;
  create trigger element_assignees_guard_reviewer before insert or update of role or delete on public.element_assignees
    for each row execute function public.element_assignees_guard_reviewer();
  $ddl$;
end $$;
