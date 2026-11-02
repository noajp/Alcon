-- A deal's next step took three writes from the browser: create or update
-- the Element, assign the deal's owner, point the deal at it. A failure
-- part way left an Element no deal pointed at, and trying again made
-- another (ELE_OBJ-005). One call now does all three in one transaction,
-- as the caller (security invoker), so every row-level rule still applies.
-- crm_hand_over is the precedent.
--
-- p_object_id / p_create are the app's decision of where the step lands
-- (the pipeline's Object, or the caller's own My Elements); the owner's
-- assignment is the one part allowed to fail — the step stays, unassigned,
-- and the result says so (notice 'owner_unassignable').
do $mig$
begin
  if to_regclass('public.crm_deals') is null or to_regclass('public.elements') is null
     or to_regclass('public.element_assignees') is null then
    raise notice 'crm_set_next_step skipped: base schema not present'; return;
  end if;

  execute $f$
    create or replace function public.crm_set_next_step(
      p_deal uuid, p_title text, p_due date,
      p_element uuid, p_object_id uuid, p_create boolean,
      p_description text, p_owner_worker uuid)
    returns jsonb language plpgsql security invoker set search_path = public as $fn$
    declare
      v_title text := btrim(coalesce(p_title, ''));
      v_element uuid := p_element;
      v_order integer;
      v_notice text;
    begin
      if v_title = '' then
        raise exception 'Describe the next step.' using errcode = '22023';
      end if;
      if v_element is not null then
        update public.elements set title = v_title, due_date = p_due where id = v_element;
        if not found then raise exception 'The next step''s Element could not be changed.' using errcode = '42501'; end if;
      elsif p_create then
        select coalesce(max(order_index), -1) + 1 into v_order from public.elements
         where object_id is not distinct from p_object_id;
        insert into public.elements (title, due_date, start_date, status, priority, object_id, owner_id,
                                     description, labels, order_index)
        values (v_title, p_due, p_due, 'todo', 'medium', p_object_id,
                case when p_object_id is null then (select auth.uid()) end,
                p_description, '["crm"]'::jsonb, v_order)
        returning id into v_element;
        if p_owner_worker is not null then
          begin
            insert into public.element_assignees (element_id, worker_id, role)
            values (v_element, p_owner_worker, 'assignee');
          exception when others then
            v_notice := 'owner_unassignable';
          end;
        end if;
      else
        v_notice := 'saved_on_deal';
      end if;
      update public.crm_deals set next_element_id = v_element, next_step = v_title, next_step_on = p_due
       where id = p_deal;
      if not found then raise exception 'The deal could not be changed.' using errcode = '42501'; end if;
      return jsonb_build_object('element_id', v_element, 'notice', v_notice);
    end;
    $fn$
  $f$;
  execute 'revoke all on function public.crm_set_next_step(uuid, text, date, uuid, uuid, boolean, text, uuid) from public, anon';
  execute 'grant execute on function public.crm_set_next_step(uuid, text, date, uuid, uuid, boolean, text, uuid) to authenticated';
end $mig$;
