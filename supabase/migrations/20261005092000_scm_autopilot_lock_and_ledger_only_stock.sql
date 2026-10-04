-- 1. The daily autopilot run is claimed in the database before any order is
--    written, so two tabs or two members opening SCM at once cannot both run it.
-- 2. On-hand is written only by the ledger trigger: members read scm_stock,
--    they do not write it.
-- 3. A receipt must receive something.
-- 4. Orders drafted by Copilot are told apart from the autopilot's.
do $$
begin
  if to_regclass('public.scm_stock') is null or to_regclass('public.scm_autopilot_runs') is null then
    raise notice 'scm autopilot lock skipped: scm schema not present';
    return;
  end if;

  execute $ddl$
  create or replace function public.scm_claim_autopilot_run(p_space uuid, p_min_hours numeric default 20)
  returns uuid language plpgsql security invoker set search_path = public as $fn$
  declare
    last_run timestamptz;
    run_id uuid;
  begin
    if not public.is_activity_space_member(p_space) then raise exception 'Not a member of this Space'; end if;
    perform pg_advisory_xact_lock(hashtext('scm_autopilot:' || p_space::text));
    select max(ran_at) into last_run from public.scm_autopilot_runs where activity_space_id = p_space;
    if last_run is not null and last_run > now() - make_interval(secs => p_min_hours * 3600) then
      return null;
    end if;
    insert into public.scm_autopilot_runs (activity_space_id, summary)
    values (p_space, jsonb_build_object('status', 'running', 'created', '[]'::jsonb, 'skipped', 0, 'trigger', 'autopilot'))
    returning id into run_id;
    return run_id;
  end $fn$;
  revoke all on function public.scm_claim_autopilot_run(uuid, numeric) from public, anon;
  grant execute on function public.scm_claim_autopilot_run(uuid, numeric) to authenticated;
  $ddl$;

  -- The ledger trigger writes on-hand with the definer's rights; the
  -- movement it applies was already checked by the movements' RLS.
  execute $ddl$
  create or replace function public.scm_apply_movement() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    insert into public.scm_stock (activity_space_id, item_id, location_id, on_hand, updated_at)
    values (new.activity_space_id, new.item_id, new.location_id, new.quantity, now())
    on conflict (item_id, location_id)
    do update set on_hand = public.scm_stock.on_hand + excluded.on_hand, updated_at = now();
    return new;
  end $fn$;
  revoke all on function public.scm_apply_movement() from public, anon, authenticated;

  drop policy if exists scm_stock_members on public.scm_stock;
  drop policy if exists scm_stock_read on public.scm_stock;
  create policy scm_stock_read on public.scm_stock for select to authenticated using (public.is_activity_space_member(activity_space_id));
  $ddl$;

  -- A count with no difference on a never-stocked location records the
  -- location as stocked (zero) through the same definer path.
  execute $ddl$
  create or replace function public.scm_count_stock(p_item uuid, p_location uuid, p_counted numeric, p_on date default current_date, p_note text default null)
  returns numeric language plpgsql security definer set search_path = public as $fn$
  declare
    space uuid;
    current_on_hand numeric;
    delta numeric;
  begin
    if p_counted is null or p_counted < 0 then raise exception 'Counted quantity must be zero or more'; end if;
    select activity_space_id into space from public.scm_items where id = p_item;
    if space is null or not public.is_activity_space_member(space) then raise exception 'Item not found'; end if;
    if not exists (select 1 from public.scm_locations where id = p_location and activity_space_id = space) then raise exception 'Location not found'; end if;
    select on_hand into current_on_hand from public.scm_stock where item_id = p_item and location_id = p_location for update;
    delta := p_counted - coalesce(current_on_hand, 0);
    if delta <> 0 then
      insert into public.scm_movements (activity_space_id, item_id, location_id, kind, quantity, occurred_on, note, created_by)
      values (space, p_item, p_location, 'adjust', delta, p_on, coalesce(p_note, 'Stock count'), auth.uid());
    elsif current_on_hand is null then
      insert into public.scm_stock (activity_space_id, item_id, location_id, on_hand) values (space, p_item, p_location, 0);
    end if;
    return delta;
  end $fn$;
  revoke all on function public.scm_count_stock(uuid, uuid, numeric, date, text) from public, anon;
  grant execute on function public.scm_count_stock(uuid, uuid, numeric, date, text) to authenticated;
  $ddl$;

  execute $ddl$
  create or replace function public.scm_receive_po(p_po uuid, p_lines jsonb, p_received_on date default current_date)
  returns text language plpgsql security invoker set search_path = public as $fn$
  declare
    po public.scm_purchase_orders%rowtype;
    entry jsonb;
    line public.scm_po_lines%rowtype;
    qty numeric;
    open_left numeric;
    received_any boolean := false;
  begin
    select * into po from public.scm_purchase_orders where id = p_po for update;
    if not found then raise exception 'Purchase order not found'; end if;
    if po.status not in ('approved','sent','partial') then
      raise exception 'Only approved, sent or partly received orders can be received (this one is %)', po.status;
    end if;
    for entry in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
      qty := (entry->>'quantity')::numeric;
      if qty is null or qty <= 0 then continue; end if;
      select * into line from public.scm_po_lines where id = (entry->>'line_id')::uuid and po_id = po.id for update;
      if not found then raise exception 'Line does not belong to this order'; end if;
      update public.scm_po_lines set received_quantity = received_quantity + qty where id = line.id;
      insert into public.scm_movements (activity_space_id, item_id, location_id, kind, quantity, occurred_on, po_id, note)
      values (po.activity_space_id, line.item_id, po.location_id, 'receipt', qty, p_received_on, po.id, 'PO-' || po.number);
      received_any := true;
    end loop;
    if not received_any then raise exception 'Enter a received quantity for at least one line'; end if;
    select coalesce(sum(greatest(quantity - received_quantity, 0)), 0) into open_left from public.scm_po_lines where po_id = po.id;
    update public.scm_purchase_orders
      set status = case when open_left <= 0 then 'received' else 'partial' end,
          received_on = case when open_left <= 0 then p_received_on else received_on end
      where id = po.id;
    return case when open_left <= 0 then 'received' else 'partial' end;
  end $fn$;
  $ddl$;

  execute $ddl$
  alter table public.scm_purchase_orders drop constraint if exists scm_purchase_orders_source_check;
  alter table public.scm_purchase_orders add constraint scm_purchase_orders_source_check check (source in ('human','autopilot','copilot'));
  $ddl$;
end $$;
