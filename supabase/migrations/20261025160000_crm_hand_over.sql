-- Handing one person's CRM work to another in one transaction: their open
-- deals (as the database sees them now), the next-step Elements of those deals,
-- and the companies and contacts they own. Runs with the caller's rights, so
-- only records the caller can see move. A next step whose Element the new
-- owner cannot be assigned to keeps its old owner and is counted, never left
-- with no one. Each moved deal records the hand-over in its history.
do $$
begin
  if to_regclass('public.crm_deals') is null or to_regclass('public.element_assignees') is null then
    raise notice 'crm hand over skipped: base tables not present';
    return;
  end if;

  execute $ddl$
  create or replace function public.crm_hand_over(p_space uuid, p_from uuid, p_to uuid, p_note text, p_author text)
  returns jsonb language plpgsql security invoker set search_path = public as $fn$
  declare
    v_deal record;
    v_deals int := 0;
    v_unassigned int := 0;
    v_companies int;
    v_contacts int;
  begin
    if p_from is null or p_to is null or p_from = p_to then
      raise exception 'Choose two different people' using errcode = '22023';
    end if;
    for v_deal in
      update public.crm_deals set owner_worker_id = p_to
      where activity_space_id = p_space and owner_worker_id = p_from and lower(stage) not in ('won', 'lost')
      returning id, next_element_id
    loop
      v_deals := v_deals + 1;
      insert into public.crm_activities (activity_space_id, deal_id, kind, body, author_name)
      values (p_space, v_deal.id, 'note', left(p_note, 8000), p_author);
      if v_deal.next_element_id is not null and exists (
        select 1 from public.elements e where e.id = v_deal.next_element_id and e.status not in ('done', 'cancelled')
      ) then
        begin
          -- The new owner first: the step is never left with no one.
          begin
            insert into public.element_assignees (element_id, worker_id, role) values (v_deal.next_element_id, p_to, 'assignee');
          exception when unique_violation then null;
          end;
          delete from public.element_assignees where element_id = v_deal.next_element_id and worker_id = p_from and role = 'assignee';
        exception when others then
          v_unassigned := v_unassigned + 1;
        end;
      end if;
    end loop;
    update public.crm_companies set owner_worker_id = p_to where activity_space_id = p_space and owner_worker_id = p_from;
    get diagnostics v_companies = row_count;
    update public.crm_contacts set owner_worker_id = p_to where activity_space_id = p_space and owner_worker_id = p_from;
    get diagnostics v_contacts = row_count;
    return jsonb_build_object('deals', v_deals, 'companies', v_companies, 'contacts', v_contacts, 'unassigned', v_unassigned);
  end $fn$;
  revoke all on function public.crm_hand_over(uuid, uuid, uuid, text, text) from public, anon;
  grant execute on function public.crm_hand_over(uuid, uuid, uuid, text, text) to authenticated;
  $ddl$;
end $$;
