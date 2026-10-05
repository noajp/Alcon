-- Supply records follow the Domain they belong to (ELE_DEC-013 stage 1).
--
-- A location, supplier or item may belong to one Domain of its Space
-- (domain_id); without one it is shared by the Space as before. A record that
-- belongs to a Domain is seen and changed only by the people who can see that
-- Domain (user_can_see_domain), so a private Domain's depots, suppliers and
-- items stay inside it. Stock, ledger rows, orders and order lines are seen
-- through what they refer to: every location, supplier and item they name must
-- be visible.
--
-- One record never mixes two Domains:
--   - an item of a Domain is stocked, moved and ordered only at locations of
--     that Domain;
--   - a supplier of a Domain delivers only to locations of that Domain, and is
--     the default supplier only of items of that Domain.
-- A Space-wide item or supplier can serve any location. Changing a record's
-- Domain is refused while its history says otherwise.
--
-- The daily autopilot is claimed per scope (the Space-wide records, or one
-- Domain), so a member who cannot see a Domain does not use up its run.
-- Resetting SCM is refused while it would delete records the caller cannot see.
-- Order numbers and the monthly budget stay one per Space: numbering and the
-- month's committed spend are read across every Domain (as definer), so a
-- member who cannot see a Domain neither reuses its numbers nor spends its
-- share of the budget twice.
do $$
begin
  if to_regclass('public.scm_locations') is null
     or to_regclass('public.domains') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'scm domain scope skipped: base schema not present';
    return;
  end if;

  execute $ddl$
  alter table public.scm_locations add column if not exists domain_id uuid references public.domains(id);
  alter table public.scm_suppliers add column if not exists domain_id uuid references public.domains(id);
  alter table public.scm_items add column if not exists domain_id uuid references public.domains(id);
  alter table public.scm_autopilot_runs add column if not exists domain_id uuid references public.domains(id) on delete cascade;
  create index if not exists scm_locations_domain on public.scm_locations (domain_id) where domain_id is not null;
  create index if not exists scm_suppliers_domain on public.scm_suppliers (domain_id) where domain_id is not null;
  create index if not exists scm_items_domain on public.scm_items (domain_id) where domain_id is not null;
  create index if not exists scm_autopilot_runs_scope on public.scm_autopilot_runs (activity_space_id, domain_id, ran_at desc);
  $ddl$;

  -- Visibility helpers. Definer so the policies below can look across tables
  -- without recursing into each other's RLS.
  execute $ddl$
  create or replace function public.scm_scope_visible(p_space uuid, p_domain uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select public.is_activity_space_member(p_space)
       and (p_domain is null or public.user_can_see_domain(p_domain))
  $fn$;
  create or replace function public.scm_location_visible(p_location uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select coalesce((select public.scm_scope_visible(l.activity_space_id, l.domain_id) from public.scm_locations l where l.id = p_location), false)
  $fn$;
  create or replace function public.scm_item_visible(p_item uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select coalesce((select public.scm_scope_visible(i.activity_space_id, i.domain_id) from public.scm_items i where i.id = p_item), false)
  $fn$;
  create or replace function public.scm_supplier_visible(p_supplier uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select coalesce((select public.scm_scope_visible(s.activity_space_id, s.domain_id) from public.scm_suppliers s where s.id = p_supplier), false)
  $fn$;
  create or replace function public.scm_po_visible(p_po uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select coalesce((select public.scm_location_visible(o.location_id) and public.scm_supplier_visible(o.supplier_id)
                       from public.scm_purchase_orders o where o.id = p_po), false)
  $fn$;
  revoke all on function public.scm_scope_visible(uuid, uuid) from public, anon;
  revoke all on function public.scm_location_visible(uuid) from public, anon;
  revoke all on function public.scm_item_visible(uuid) from public, anon;
  revoke all on function public.scm_supplier_visible(uuid) from public, anon;
  revoke all on function public.scm_po_visible(uuid) from public, anon;
  grant execute on function public.scm_scope_visible(uuid, uuid) to authenticated;
  grant execute on function public.scm_location_visible(uuid) to authenticated;
  grant execute on function public.scm_item_visible(uuid) to authenticated;
  grant execute on function public.scm_supplier_visible(uuid) to authenticated;
  grant execute on function public.scm_po_visible(uuid) to authenticated;
  $ddl$;

  execute $ddl$
  drop policy if exists scm_locations_members on public.scm_locations;
  drop policy if exists scm_locations_scoped on public.scm_locations;
  create policy scm_locations_scoped on public.scm_locations for all to authenticated
    using (public.scm_scope_visible(activity_space_id, domain_id)) with check (public.scm_scope_visible(activity_space_id, domain_id));

  drop policy if exists scm_suppliers_members on public.scm_suppliers;
  drop policy if exists scm_suppliers_scoped on public.scm_suppliers;
  create policy scm_suppliers_scoped on public.scm_suppliers for all to authenticated
    using (public.scm_scope_visible(activity_space_id, domain_id)) with check (public.scm_scope_visible(activity_space_id, domain_id));

  drop policy if exists scm_items_members on public.scm_items;
  drop policy if exists scm_items_scoped on public.scm_items;
  create policy scm_items_scoped on public.scm_items for all to authenticated
    using (public.scm_scope_visible(activity_space_id, domain_id)) with check (public.scm_scope_visible(activity_space_id, domain_id));

  drop policy if exists scm_stock_read on public.scm_stock;
  create policy scm_stock_read on public.scm_stock for select to authenticated
    using (public.is_activity_space_member(activity_space_id) and public.scm_location_visible(location_id) and public.scm_item_visible(item_id));

  drop policy if exists scm_movements_read on public.scm_movements;
  drop policy if exists scm_movements_write on public.scm_movements;
  create policy scm_movements_read on public.scm_movements for select to authenticated
    using (public.is_activity_space_member(activity_space_id) and public.scm_location_visible(location_id) and public.scm_item_visible(item_id));
  create policy scm_movements_write on public.scm_movements for insert to authenticated
    with check (public.is_activity_space_member(activity_space_id) and public.scm_location_visible(location_id) and public.scm_item_visible(item_id));

  drop policy if exists scm_purchase_orders_members on public.scm_purchase_orders;
  drop policy if exists scm_purchase_orders_scoped on public.scm_purchase_orders;
  create policy scm_purchase_orders_scoped on public.scm_purchase_orders for all to authenticated
    using (public.is_activity_space_member(activity_space_id) and public.scm_location_visible(location_id) and public.scm_supplier_visible(supplier_id))
    with check (public.is_activity_space_member(activity_space_id) and public.scm_location_visible(location_id) and public.scm_supplier_visible(supplier_id));

  drop policy if exists scm_po_lines_members on public.scm_po_lines;
  drop policy if exists scm_po_lines_scoped on public.scm_po_lines;
  create policy scm_po_lines_scoped on public.scm_po_lines for all to authenticated
    using (public.is_activity_space_member(activity_space_id) and public.scm_po_visible(po_id) and public.scm_item_visible(item_id))
    with check (public.is_activity_space_member(activity_space_id) and public.scm_po_visible(po_id) and public.scm_item_visible(item_id));

  drop policy if exists scm_autopilot_runs_members on public.scm_autopilot_runs;
  drop policy if exists scm_autopilot_runs_scoped on public.scm_autopilot_runs;
  create policy scm_autopilot_runs_scoped on public.scm_autopilot_runs for all to authenticated
    using (public.scm_scope_visible(activity_space_id, domain_id)) with check (public.scm_scope_visible(activity_space_id, domain_id));
  $ddl$;

  -- One record never mixes two Domains. Definer: the rule is checked against
  -- every row, including the ones the writer cannot see.
  execute $ddl$
  create or replace function public.scm_check_scope() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  declare
    target uuid;
    other uuid;
  begin
    if tg_table_name in ('scm_locations', 'scm_suppliers', 'scm_items') then
      if new.domain_id is not null
         and not exists (select 1 from public.domains d where d.id = new.domain_id and d.activity_space_id = new.activity_space_id) then
        raise exception 'Choose a Domain of this Space.';
      end if;
    end if;

    if tg_table_name = 'scm_items' then
      if new.supplier_id is not null then
        select domain_id into other from public.scm_suppliers where id = new.supplier_id for share;
        if other is not null and other is distinct from new.domain_id then
          raise exception 'This supplier belongs to another Domain. Choose a supplier of the item''s Domain or one shared by the Space.';
        end if;
      end if;
      if tg_op = 'UPDATE' and new.domain_id is distinct from old.domain_id and new.domain_id is not null then
        if exists (select 1 from public.scm_stock s join public.scm_locations l on l.id = s.location_id
                    where s.item_id = new.id and l.domain_id is distinct from new.domain_id)
           or exists (select 1 from public.scm_movements m join public.scm_locations l on l.id = m.location_id
                       where m.item_id = new.id and l.domain_id is distinct from new.domain_id)
           or exists (select 1 from public.scm_po_lines pl join public.scm_purchase_orders o on o.id = pl.po_id
                        join public.scm_locations l on l.id = o.location_id
                       where pl.item_id = new.id and l.domain_id is distinct from new.domain_id) then
          raise exception 'This item has stock or orders at locations outside that Domain.';
        end if;
      end if;
    elsif tg_table_name = 'scm_suppliers' then
      if tg_op = 'UPDATE' and new.domain_id is distinct from old.domain_id and new.domain_id is not null then
        if exists (select 1 from public.scm_purchase_orders o join public.scm_locations l on l.id = o.location_id
                    where o.supplier_id = new.id and l.domain_id is distinct from new.domain_id) then
          raise exception 'This supplier has orders for locations outside that Domain.';
        end if;
        if exists (select 1 from public.scm_items i where i.supplier_id = new.id and i.domain_id is distinct from new.domain_id) then
          raise exception 'Items outside that Domain use this supplier by default.';
        end if;
      end if;
    elsif tg_table_name = 'scm_locations' then
      if tg_op = 'UPDATE' and new.domain_id is distinct from old.domain_id then
        if exists (select 1 from public.scm_stock s join public.scm_items i on i.id = s.item_id
                    where s.location_id = new.id and i.domain_id is not null and i.domain_id is distinct from new.domain_id)
           or exists (select 1 from public.scm_movements m join public.scm_items i on i.id = m.item_id
                       where m.location_id = new.id and i.domain_id is not null and i.domain_id is distinct from new.domain_id)
           or exists (select 1 from public.scm_purchase_orders o join public.scm_po_lines pl on pl.po_id = o.id
                        join public.scm_items i on i.id = pl.item_id
                       where o.location_id = new.id and i.domain_id is not null and i.domain_id is distinct from new.domain_id)
           or exists (select 1 from public.scm_purchase_orders o join public.scm_suppliers s on s.id = o.supplier_id
                       where o.location_id = new.id and s.domain_id is not null and s.domain_id is distinct from new.domain_id) then
          raise exception 'This location holds items or orders of another Domain.';
        end if;
      end if;
    elsif tg_table_name in ('scm_stock', 'scm_movements') then
      -- FOR SHARE waits for a concurrent change of either record's Domain,
      -- whose own check then sees this row.
      select domain_id into target from public.scm_locations where id = new.location_id for share;
      select domain_id into other from public.scm_items where id = new.item_id for share;
      if other is not null and other is distinct from target then
        raise exception 'This item belongs to another Domain than the location.';
      end if;
    elsif tg_table_name = 'scm_purchase_orders' then
      select domain_id into target from public.scm_locations where id = new.location_id for share;
      select domain_id into other from public.scm_suppliers where id = new.supplier_id for share;
      if other is not null and other is distinct from target then
        raise exception 'This supplier belongs to another Domain than the delivery location.';
      end if;
      if tg_op = 'UPDATE' and new.location_id is distinct from old.location_id
         and exists (select 1 from public.scm_po_lines pl join public.scm_items i on i.id = pl.item_id
                      where pl.po_id = new.id and i.domain_id is not null and i.domain_id is distinct from target) then
        raise exception 'This order has items of another Domain than the delivery location.';
      end if;
    elsif tg_table_name = 'scm_po_lines' then
      select l.domain_id into target from public.scm_purchase_orders o join public.scm_locations l on l.id = o.location_id where o.id = new.po_id for share of o, l;
      select domain_id into other from public.scm_items where id = new.item_id for share;
      if other is not null and other is distinct from target then
        raise exception 'This item belongs to another Domain than the order''s delivery location.';
      end if;
    end if;
    return new;
  end $fn$;
  revoke all on function public.scm_check_scope() from public, anon, authenticated;

  drop trigger if exists scm_locations_scope on public.scm_locations;
  create trigger scm_locations_scope before insert or update of domain_id, activity_space_id on public.scm_locations for each row execute function public.scm_check_scope();
  drop trigger if exists scm_suppliers_scope on public.scm_suppliers;
  create trigger scm_suppliers_scope before insert or update of domain_id, activity_space_id on public.scm_suppliers for each row execute function public.scm_check_scope();
  drop trigger if exists scm_items_scope on public.scm_items;
  create trigger scm_items_scope before insert or update of domain_id, supplier_id, activity_space_id on public.scm_items for each row execute function public.scm_check_scope();
  drop trigger if exists scm_stock_scope on public.scm_stock;
  create trigger scm_stock_scope before insert on public.scm_stock for each row execute function public.scm_check_scope();
  drop trigger if exists scm_movements_scope on public.scm_movements;
  create trigger scm_movements_scope before insert on public.scm_movements for each row execute function public.scm_check_scope();
  drop trigger if exists scm_purchase_orders_scope on public.scm_purchase_orders;
  create trigger scm_purchase_orders_scope before insert or update of supplier_id, location_id on public.scm_purchase_orders for each row execute function public.scm_check_scope();
  drop trigger if exists scm_po_lines_scope on public.scm_po_lines;
  create trigger scm_po_lines_scope before insert or update of item_id, po_id on public.scm_po_lines for each row execute function public.scm_check_scope();
  $ddl$;

  -- A Domain that holds supply records stays in its Space and is not deleted
  -- out from under them; deleting the whole Space still takes everything.
  execute $ddl$
  create or replace function public.scm_guard_domain() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    if tg_op = 'DELETE' and not exists (select 1 from public.activity_spaces where id = old.activity_space_id) then
      return old;
    end if;
    if tg_op = 'UPDATE' and new.activity_space_id is not distinct from old.activity_space_id then
      return new;
    end if;
    if exists (select 1 from public.scm_locations where domain_id = old.id)
       or exists (select 1 from public.scm_suppliers where domain_id = old.id)
       or exists (select 1 from public.scm_items where domain_id = old.id) then
      raise exception 'This Domain holds SCM locations, suppliers or items. Move them to the Space or another Domain first.';
    end if;
    return coalesce(new, old);
  end $fn$;
  revoke all on function public.scm_guard_domain() from public, anon, authenticated;
  drop trigger if exists domains_scm_guard on public.domains;
  create trigger domains_scm_guard before update of activity_space_id or delete on public.domains for each row execute function public.scm_guard_domain();
  $ddl$;

  -- Counting checks what the caller can see, not just Space membership.
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
    if space is null or not public.scm_item_visible(p_item) then raise exception 'Item not found'; end if;
    if not exists (select 1 from public.scm_locations where id = p_location and activity_space_id = space)
       or not public.scm_location_visible(p_location) then raise exception 'Location not found'; end if;
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

  -- The daily run is claimed per scope: the Space-wide records (null) or one Domain.
  execute $ddl$
  drop function if exists public.scm_claim_autopilot_run(uuid, numeric);
  create or replace function public.scm_claim_autopilot_run(p_space uuid, p_min_hours numeric default 20, p_domain uuid default null)
  returns uuid language plpgsql security invoker set search_path = public as $fn$
  declare
    last_run timestamptz;
    run_id uuid;
  begin
    if not public.scm_scope_visible(p_space, p_domain) then raise exception 'Not a member of this Space or Domain'; end if;
    if p_domain is not null and not exists (select 1 from public.domains where id = p_domain and activity_space_id = p_space) then
      raise exception 'Choose a Domain of this Space.';
    end if;
    perform pg_advisory_xact_lock(hashtext('scm_autopilot:' || p_space::text || ':' || coalesce(p_domain::text, 'space')));
    select max(ran_at) into last_run from public.scm_autopilot_runs
     where activity_space_id = p_space and domain_id is not distinct from p_domain;
    if last_run is not null and last_run > now() - make_interval(secs => p_min_hours * 3600) then
      return null;
    end if;
    insert into public.scm_autopilot_runs (activity_space_id, domain_id, summary)
    values (p_space, p_domain, jsonb_build_object('status', 'running', 'created', '[]'::jsonb, 'skipped', 0, 'trigger', 'autopilot'))
    returning id into run_id;
    return run_id;
  end $fn$;
  revoke all on function public.scm_claim_autopilot_run(uuid, numeric, uuid) from public, anon;
  grant execute on function public.scm_claim_autopilot_run(uuid, numeric, uuid) to authenticated;
  $ddl$;

  -- Reset deletes everything SCM holds for the Space, so it needs a caller
  -- who can see all of it: foreign-key cascades do not ask RLS.
  execute $ddl$
  create or replace function public.scm_has_hidden_records(p_space uuid) returns boolean
  language sql stable security definer set search_path = public as $fn$
    select public.is_activity_space_member(p_space) and (
           exists (select 1 from public.scm_locations where activity_space_id = p_space and domain_id is not null and not public.user_can_see_domain(domain_id))
        or exists (select 1 from public.scm_suppliers where activity_space_id = p_space and domain_id is not null and not public.user_can_see_domain(domain_id))
        or exists (select 1 from public.scm_items where activity_space_id = p_space and domain_id is not null and not public.user_can_see_domain(domain_id)))
  $fn$;
  revoke all on function public.scm_has_hidden_records(uuid) from public, anon;
  grant execute on function public.scm_has_hidden_records(uuid) to authenticated;

  create or replace function public.scm_reset_space(p_space uuid) returns void
  language plpgsql security invoker set search_path = public as $fn$
  begin
    if not public.is_activity_space_member(p_space) then raise exception 'Not a member of this Space'; end if;
    if public.scm_has_hidden_records(p_space) then
      raise exception 'Some supply records belong to Domains you cannot see. Ask a member of those Domains to remove them first.';
    end if;
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
  -- One order number sequence per Space, across Domains the writer cannot see.
  execute $ddl$
  create or replace function public.scm_number_po() returns trigger
  language plpgsql security definer set search_path = public as $fn$
  begin
    perform pg_advisory_xact_lock(hashtext('scm_po:' || new.activity_space_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.scm_purchase_orders where activity_space_id = new.activity_space_id;
    return new;
  end $fn$;
  revoke all on function public.scm_number_po() from public, anon, authenticated;
  $ddl$;

  -- The month's committed spend in the policy currency, across every Domain:
  -- the budget is the Space's, so the planner's authority is judged against
  -- all of it. Only the total is returned.
  execute $ddl$
  create or replace function public.scm_committed_spend(p_space uuid, p_from date, p_to date, p_currency text) returns numeric
  language plpgsql stable security definer set search_path = public as $fn$
  begin
    if not public.is_activity_space_member(p_space) then raise exception 'Not a member of this Space'; end if;
    return coalesce((
      select sum(l.quantity * l.unit_cost)
        from public.scm_purchase_orders o join public.scm_po_lines l on l.po_id = o.id
       where o.activity_space_id = p_space and o.currency = p_currency
         and o.status not in ('draft', 'cancelled') and o.ordered_on between p_from and p_to), 0);
  end $fn$;
  revoke all on function public.scm_committed_spend(uuid, date, date, text) from public, anon;
  grant execute on function public.scm_committed_spend(uuid, date, date, text) to authenticated;
  $ddl$;
end $$;
