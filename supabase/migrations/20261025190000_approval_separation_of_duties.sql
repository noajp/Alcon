-- Who may decide an approval (ELE_AI-139). Seeing an Element is not enough:
-- an approval is a check by someone other than the person doing the work.
--   * When the Element names reviewers, only they decide.
--   * Otherwise an owner or admin of a Domain the Element lives in decides.
--   * Nobody decides on an Element they are assigned to.
--   * A personal Element (no Object) with no reviewers is decided by its owner.
-- The same people are the only ones who can take the approval step off an
-- Element or set its state directly; anyone who can edit it can still ask for
-- approval (turn it on, or send it back to pending).
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
  create or replace function public.user_can_decide_approval(p_element uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    with me as (
      select w.id from public.workers w where w.user_id = auth.uid() and w.type = 'human'
    ),
    homes as (
      select e.object_id from public.elements e where e.id = p_element and e.object_id is not null
      union
      select eo.object_id from public.element_objects eo where eo.element_id = p_element
    ),
    domains as (
      select o.domain_id from homes h join public.objects o on o.id = h.object_id where o.domain_id is not null
      union
      select od.domain_id from homes h join public.object_domains od on od.object_id = h.object_id
    )
    select auth.uid() is not null
      and public.user_can_see_element(p_element)
      -- Never one's own work.
      and not exists (select 1 from public.element_assignees ea where ea.element_id = p_element and ea.role = 'assignee' and ea.worker_id in (select id from me))
      and case
        when exists (select 1 from public.element_assignees ea where ea.element_id = p_element and ea.role = 'reviewer')
          then exists (select 1 from public.element_assignees ea where ea.element_id = p_element and ea.role = 'reviewer' and ea.worker_id in (select id from me))
        when exists (select 1 from homes)
          then exists (select 1 from domains d where public.user_has_domain_role(d.domain_id, array['owner', 'admin']))
        else exists (select 1 from public.elements e where e.id = p_element and e.owner_id = auth.uid())
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
      if new.is_approval then new.approval_state := 'pending'; else new.approval_state := null; end if;
      return new;
    end if;
    if (old.is_approval and not coalesce(new.is_approval, false))
       or (new.approval_state is distinct from old.approval_state and coalesce(new.approval_state, 'pending') <> 'pending') then
      if not public.user_can_decide_approval(new.id) then
        raise exception 'Only a reviewer, or an owner or admin of its Domain who is not working on it, can decide this approval'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end $fn$;
  revoke all on function public.elements_guard_approval() from public, anon, authenticated;
  drop trigger if exists elements_guard_approval on public.elements;
  create trigger elements_guard_approval before insert or update of is_approval, approval_state on public.elements
    for each row execute function public.elements_guard_approval();
  $ddl$;
end $$;
