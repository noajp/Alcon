-- Deleting never erases history by cascade. A location, supplier or item can
-- be deleted only while nothing records it (no ledger rows, no orders);
-- otherwise it is archived or renamed instead. Only draft orders can be
-- deleted. Order lines cannot be changed once the order is closed, nor cut
-- below what was already received. The deliberate exceptions are deleting the
-- whole Space (cascade) and scm_reset_space, which says so explicitly.
do $$
begin
  if to_regclass('public.scm_items') is null or to_regclass('public.scm_po_lines') is null then
    raise notice 'scm delete guards skipped: scm schema not present';
    return;
  end if;

  execute $ddl$
  create or replace function public.scm_guard_delete() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    -- Removing the whole Space, or an explicit reset, takes everything with it.
    if current_setting('scm.reset', true) = 'on'
       or not exists (select 1 from public.activity_spaces where id = old.activity_space_id) then
      return old;
    end if;
    if tg_table_name = 'scm_locations' then
      if exists (select 1 from public.scm_movements where location_id = old.id)
         or exists (select 1 from public.scm_purchase_orders where location_id = old.id) then
        raise exception 'This location has stock history or orders. Rename it instead of deleting it.';
      end if;
    elsif tg_table_name = 'scm_suppliers' then
      if exists (select 1 from public.scm_purchase_orders where supplier_id = old.id) then
        raise exception 'This supplier has purchase orders. Keep it for their history.';
      end if;
    elsif tg_table_name = 'scm_items' then
      if exists (select 1 from public.scm_movements where item_id = old.id)
         or exists (select 1 from public.scm_po_lines where item_id = old.id) then
        raise exception 'This item has stock history or orders. Archive it instead of deleting it.';
      end if;
    elsif tg_table_name = 'scm_purchase_orders' then
      if old.status <> 'draft' then
        raise exception 'Only draft orders can be deleted. Cancel this order instead.';
      end if;
    end if;
    return old;
  end $fn$;

  drop trigger if exists scm_locations_guard_delete on public.scm_locations;
  create trigger scm_locations_guard_delete before delete on public.scm_locations for each row execute function public.scm_guard_delete();
  drop trigger if exists scm_suppliers_guard_delete on public.scm_suppliers;
  create trigger scm_suppliers_guard_delete before delete on public.scm_suppliers for each row execute function public.scm_guard_delete();
  drop trigger if exists scm_items_guard_delete on public.scm_items;
  create trigger scm_items_guard_delete before delete on public.scm_items for each row execute function public.scm_guard_delete();
  drop trigger if exists scm_purchase_orders_guard_delete on public.scm_purchase_orders;
  create trigger scm_purchase_orders_guard_delete before delete on public.scm_purchase_orders for each row execute function public.scm_guard_delete();
  revoke all on function public.scm_guard_delete() from public, anon, authenticated;
  $ddl$;

  execute $ddl$
  create or replace function public.scm_guard_po_line() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    po_status text;
    line public.scm_po_lines;
  begin
    if current_setting('scm.reset', true) = 'on' then return coalesce(new, old); end if;
    line := coalesce(new, old);
    select status into po_status from public.scm_purchase_orders where id = line.po_id;
    -- The order itself is being deleted (a draft, or a cascade): nothing to guard.
    if po_status is null then return coalesce(new, old); end if;
    if tg_op = 'UPDATE' and new.received_quantity <> old.received_quantity and new.quantity = old.quantity then
      return new; -- receiving
    end if;
    if po_status in ('received', 'cancelled') then
      raise exception 'This order is closed; its lines cannot change.';
    end if;
    if tg_op = 'DELETE' and old.received_quantity > 0 then
      raise exception 'This line has receipts and cannot be removed.';
    end if;
    if tg_op = 'UPDATE' and new.quantity < old.received_quantity then
      raise exception 'A line cannot be cut below what was already received.';
    end if;
    return coalesce(new, old);
  end $fn$;
  drop trigger if exists scm_po_lines_guard on public.scm_po_lines;
  create trigger scm_po_lines_guard before insert or update or delete on public.scm_po_lines for each row execute function public.scm_guard_po_line();
  revoke all on function public.scm_guard_po_line() from public, anon, authenticated;
  $ddl$;

  -- Resetting SCM deletes every record of the Space, for a member, on purpose.
  execute $ddl$
  create or replace function public.scm_reset_space(p_space uuid) returns void
  language plpgsql security invoker set search_path = public as $fn$
  begin
    if not public.is_activity_space_member(p_space) then raise exception 'Not a member of this Space'; end if;
    perform set_config('scm.reset', 'on', true);
    delete from public.scm_purchase_orders where activity_space_id = p_space;
    delete from public.scm_items where activity_space_id = p_space;
    delete from public.scm_suppliers where activity_space_id = p_space;
    delete from public.scm_locations where activity_space_id = p_space;
    delete from public.scm_autopilot_runs where activity_space_id = p_space;
    delete from public.scm_policies where activity_space_id = p_space;
    perform set_config('scm.reset', 'off', true);
  end $fn$;
  revoke all on function public.scm_reset_space(uuid) from public, anon;
  grant execute on function public.scm_reset_space(uuid) to authenticated;
  $ddl$;
end $$;
