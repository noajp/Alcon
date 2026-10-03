-- Order line edits apply all-or-nothing, never leave an order without lines,
-- and close a partly received order whose remaining lines are all received.
-- The receiving shortcut in the line guard accepts only a change to the
-- received quantity. A movement can be reversed once, and the reversal
-- points at what it reverses.
do $$
begin
  if to_regclass('public.scm_po_lines') is null or to_regclass('public.scm_movements') is null then
    raise notice 'scm line edits skipped: scm schema not present';
    return;
  end if;

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
    if po_status is null then return coalesce(new, old); end if;
    -- Receiving changes the received quantity and nothing else.
    if tg_op = 'UPDATE' and new.received_quantity <> old.received_quantity
       and new.quantity = old.quantity and new.item_id = old.item_id and new.unit_cost = old.unit_cost and new.po_id = old.po_id then
      return new;
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
  $ddl$;

  execute $ddl$
  create or replace function public.scm_update_po_lines(p_po uuid, p_changes jsonb, p_adds jsonb)
  returns text language plpgsql security invoker set search_path = public as $fn$
  declare
    po public.scm_purchase_orders%rowtype;
    entry jsonb;
    qty numeric;
    remaining integer;
    open_left numeric;
  begin
    select * into po from public.scm_purchase_orders where id = p_po for update;
    if not found then raise exception 'Purchase order not found'; end if;
    for entry in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
      qty := (entry->>'quantity')::numeric;
      if qty is null or qty < 0 then raise exception 'Enter a quantity of zero or more. Zero removes the line.'; end if;
      if qty = 0 then
        delete from public.scm_po_lines where id = (entry->>'line_id')::uuid and po_id = po.id;
      else
        update public.scm_po_lines set quantity = qty where id = (entry->>'line_id')::uuid and po_id = po.id;
      end if;
    end loop;
    for entry in select * from jsonb_array_elements(coalesce(p_adds, '[]'::jsonb)) loop
      qty := (entry->>'quantity')::numeric;
      if qty is null or qty <= 0 then raise exception 'Enter a quantity above zero for every new line.'; end if;
      insert into public.scm_po_lines (activity_space_id, po_id, item_id, quantity, unit_cost)
      values (po.activity_space_id, po.id, (entry->>'item_id')::uuid, qty, coalesce((entry->>'unit_cost')::numeric, 0));
    end loop;
    select count(*) into remaining from public.scm_po_lines where po_id = po.id;
    if remaining = 0 then raise exception 'An order needs at least one line. Cancel it instead of removing every line.'; end if;
    if po.status = 'partial' then
      select coalesce(sum(greatest(quantity - received_quantity, 0)), 0) into open_left from public.scm_po_lines where po_id = po.id;
      if open_left <= 0 then
        update public.scm_purchase_orders set status = 'received', received_on = coalesce(received_on, current_date) where id = po.id;
        return 'received';
      end if;
    end if;
    return po.status;
  end $fn$;
  revoke all on function public.scm_update_po_lines(uuid, jsonb, jsonb) from public, anon;
  grant execute on function public.scm_update_po_lines(uuid, jsonb, jsonb) to authenticated;
  $ddl$;

  execute $ddl$
  alter table public.scm_movements add column if not exists reverses_id uuid references public.scm_movements(id) on delete set null;
  create unique index if not exists scm_movements_reverses_once on public.scm_movements (reverses_id) where reverses_id is not null;
  $ddl$;
end $$;
