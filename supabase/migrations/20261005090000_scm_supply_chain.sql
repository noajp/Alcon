-- SCM: a Space's supply chain. Locations hold stock of Items bought from
-- Suppliers; every stock change is a row in the movement ledger, and the
-- on-hand figure is maintained from that ledger. Purchase orders carry the
-- incoming supply the planner projects, and the policy row is the intent the
-- autopilot plans within (service level, budget, approval authority).
-- Everything is readable and writable by members of the owning Space.
-- Cross-row references are composite (id, activity_space_id) so a row can
-- never point into another Space.
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.elements') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'scm schema skipped: activity_spaces not present';
    return;
  end if;

  execute $ddl$
  create table if not exists public.scm_locations (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 120),
    code text check (code is null or length(code) <= 32),
    created_at timestamptz not null default now(),
    unique (id, activity_space_id)
  );

  create table if not exists public.scm_suppliers (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 160),
    contact text,
    email text,
    lead_time_days numeric not null default 14 check (lead_time_days >= 0 and lead_time_days <= 730),
    currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
    notes text,
    created_at timestamptz not null default now(),
    unique (id, activity_space_id)
  );

  create table if not exists public.scm_items (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    sku text not null check (length(btrim(sku)) between 1 and 64),
    name text not null check (length(btrim(name)) between 1 and 200),
    unit text not null default 'pcs' check (length(unit) between 1 and 16),
    category text,
    supplier_id uuid,
    unit_cost numeric not null default 0 check (unit_cost >= 0),
    unit_price numeric check (unit_price is null or unit_price >= 0),
    currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
    lead_time_days numeric check (lead_time_days is null or (lead_time_days >= 0 and lead_time_days <= 730)),
    moq numeric not null default 0 check (moq >= 0),
    order_multiple numeric not null default 1 check (order_multiple > 0),
    service_level numeric check (service_level is null or (service_level >= 0.5 and service_level <= 0.999)),
    baseline_daily_demand numeric check (baseline_daily_demand is null or baseline_daily_demand >= 0),
    active boolean not null default true,
    created_at timestamptz not null default now(),
    unique (id, activity_space_id),
    unique (activity_space_id, sku),
    foreign key (supplier_id, activity_space_id) references public.scm_suppliers(id, activity_space_id) on delete set null (supplier_id)
  );

  create table if not exists public.scm_stock (
    activity_space_id uuid not null,
    item_id uuid not null,
    location_id uuid not null,
    on_hand numeric not null default 0,
    updated_at timestamptz not null default now(),
    primary key (item_id, location_id),
    foreign key (item_id, activity_space_id) references public.scm_items(id, activity_space_id) on delete cascade,
    foreign key (location_id, activity_space_id) references public.scm_locations(id, activity_space_id) on delete cascade
  );

  create table if not exists public.scm_purchase_orders (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    number integer not null,
    supplier_id uuid not null,
    location_id uuid not null,
    status text not null default 'draft' check (status in ('draft','approved','sent','partial','received','cancelled')),
    ordered_on date not null default current_date,
    expected_on date not null,
    received_on date,
    currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
    source text not null default 'human' check (source in ('human','autopilot')),
    rationale text,
    element_id uuid references public.elements(id) on delete set null,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (id, activity_space_id),
    unique (activity_space_id, number),
    check (expected_on >= ordered_on),
    foreign key (supplier_id, activity_space_id) references public.scm_suppliers(id, activity_space_id) on delete cascade,
    foreign key (location_id, activity_space_id) references public.scm_locations(id, activity_space_id) on delete cascade
  );

  create table if not exists public.scm_po_lines (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null,
    po_id uuid not null,
    item_id uuid not null,
    quantity numeric not null check (quantity > 0),
    unit_cost numeric not null default 0 check (unit_cost >= 0),
    received_quantity numeric not null default 0 check (received_quantity >= 0),
    foreign key (po_id, activity_space_id) references public.scm_purchase_orders(id, activity_space_id) on delete cascade,
    foreign key (item_id, activity_space_id) references public.scm_items(id, activity_space_id) on delete cascade
  );

  create table if not exists public.scm_movements (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null,
    item_id uuid not null,
    location_id uuid not null,
    kind text not null check (kind in ('receipt','issue','adjust','transfer_in','transfer_out')),
    quantity numeric not null check (quantity <> 0),
    occurred_on date not null default current_date,
    po_id uuid,
    note text,
    created_by uuid default auth.uid(),
    created_at timestamptz not null default now(),
    check ((kind in ('receipt','transfer_in') and quantity > 0)
        or (kind in ('issue','transfer_out') and quantity < 0)
        or kind = 'adjust'),
    foreign key (item_id, activity_space_id) references public.scm_items(id, activity_space_id) on delete cascade,
    foreign key (location_id, activity_space_id) references public.scm_locations(id, activity_space_id) on delete cascade,
    foreign key (po_id, activity_space_id) references public.scm_purchase_orders(id, activity_space_id) on delete set null (po_id)
  );

  create table if not exists public.scm_policies (
    activity_space_id uuid primary key references public.activity_spaces(id) on delete cascade,
    service_level numeric not null default 0.95 check (service_level >= 0.5 and service_level <= 0.999),
    horizon_days integer not null default 60 check (horizon_days between 7 and 365),
    review_days integer not null default 7 check (review_days between 1 and 90),
    lookback_days integer not null default 90 check (lookback_days between 14 and 730),
    ordering_cost numeric not null default 0 check (ordering_cost >= 0),
    holding_rate numeric not null default 0.2 check (holding_rate >= 0 and holding_rate <= 2),
    autopilot_enabled boolean not null default false,
    auto_approve_limit numeric not null default 0 check (auto_approve_limit >= 0),
    monthly_budget numeric check (monthly_budget is null or monthly_budget >= 0),
    currency text not null default 'JPY' check (currency ~ '^[A-Z]{3}$'),
    updated_by uuid default auth.uid(),
    updated_at timestamptz not null default now()
  );

  create table if not exists public.scm_autopilot_runs (
    id uuid primary key default gen_random_uuid(),
    activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
    ran_at timestamptz not null default now(),
    ran_by uuid default auth.uid(),
    summary jsonb not null default '{}'::jsonb
  );

  create index if not exists scm_locations_space on public.scm_locations (activity_space_id);
  create index if not exists scm_suppliers_space on public.scm_suppliers (activity_space_id);
  create index if not exists scm_items_space on public.scm_items (activity_space_id);
  create index if not exists scm_items_supplier on public.scm_items (supplier_id);
  create index if not exists scm_stock_space on public.scm_stock (activity_space_id);
  create index if not exists scm_stock_location on public.scm_stock (location_id);
  create index if not exists scm_po_space on public.scm_purchase_orders (activity_space_id, status);
  create index if not exists scm_po_supplier on public.scm_purchase_orders (supplier_id);
  create index if not exists scm_po_location on public.scm_purchase_orders (location_id);
  create index if not exists scm_po_element on public.scm_purchase_orders (element_id);
  create index if not exists scm_po_lines_po on public.scm_po_lines (po_id);
  create index if not exists scm_po_lines_item on public.scm_po_lines (item_id);
  create index if not exists scm_po_lines_space on public.scm_po_lines (activity_space_id);
  create index if not exists scm_movements_space_day on public.scm_movements (activity_space_id, occurred_on);
  create index if not exists scm_movements_item on public.scm_movements (item_id, location_id, occurred_on);
  create index if not exists scm_movements_location on public.scm_movements (location_id);
  create index if not exists scm_movements_po on public.scm_movements (po_id);
  create index if not exists scm_autopilot_runs_space on public.scm_autopilot_runs (activity_space_id, ran_at desc);
  $ddl$;

  -- One policy for every SCM table: members of the owning Space.
  execute $ddl$
  do $inner$
  declare t text;
  begin
    foreach t in array array['scm_locations','scm_suppliers','scm_items','scm_stock','scm_purchase_orders','scm_po_lines','scm_policies','scm_autopilot_runs'] loop
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists %I on public.%I', t || '_members', t);
      execute format('create policy %I on public.%I for all to authenticated using (public.is_activity_space_member(activity_space_id)) with check (public.is_activity_space_member(activity_space_id))', t || '_members', t);
    end loop;
  end $inner$;
  $ddl$;

  -- The ledger is append-only: members read and write movements, never edit
  -- or delete them. Corrections are new 'adjust' rows.
  execute $ddl$
  alter table public.scm_movements enable row level security;
  drop policy if exists scm_movements_read on public.scm_movements;
  drop policy if exists scm_movements_write on public.scm_movements;
  create policy scm_movements_read on public.scm_movements for select to authenticated using (public.is_activity_space_member(activity_space_id));
  create policy scm_movements_write on public.scm_movements for insert to authenticated with check (public.is_activity_space_member(activity_space_id));
  $ddl$;

  -- On-hand follows the ledger.
  execute $ddl$
  create or replace function public.scm_apply_movement() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    insert into public.scm_stock (activity_space_id, item_id, location_id, on_hand, updated_at)
    values (new.activity_space_id, new.item_id, new.location_id, new.quantity, now())
    on conflict (item_id, location_id)
    do update set on_hand = public.scm_stock.on_hand + excluded.on_hand, updated_at = now();
    return new;
  end $fn$;
  drop trigger if exists scm_movements_apply on public.scm_movements;
  create trigger scm_movements_apply after insert on public.scm_movements
    for each row execute function public.scm_apply_movement();
  $ddl$;

  -- PO numbers count up per Space.
  execute $ddl$
  create or replace function public.scm_number_po() returns trigger
  language plpgsql security invoker set search_path = public as $fn$
  begin
    perform pg_advisory_xact_lock(hashtext('scm_po:' || new.activity_space_id::text));
    select coalesce(max(number), 0) + 1 into new.number from public.scm_purchase_orders where activity_space_id = new.activity_space_id;
    return new;
  end $fn$;
  drop trigger if exists scm_purchase_orders_number on public.scm_purchase_orders;
  create trigger scm_purchase_orders_number before insert on public.scm_purchase_orders
    for each row execute function public.scm_number_po();

  create or replace function public.scm_touch_po() returns trigger
  language plpgsql set search_path = public as $fn$
  begin new.updated_at := now(); return new; end $fn$;
  drop trigger if exists scm_purchase_orders_touch on public.scm_purchase_orders;
  create trigger scm_purchase_orders_touch before update on public.scm_purchase_orders
    for each row execute function public.scm_touch_po();
  $ddl$;

  -- Receive against a PO: ledger rows, received quantities and the PO status
  -- move together. Runs as the caller, so RLS decides what may be received.
  execute $ddl$
  create or replace function public.scm_receive_po(p_po uuid, p_lines jsonb, p_received_on date default current_date)
  returns text language plpgsql security invoker set search_path = public as $fn$
  declare
    po public.scm_purchase_orders%rowtype;
    entry jsonb;
    line public.scm_po_lines%rowtype;
    qty numeric;
    open_left numeric;
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
    end loop;
    select coalesce(sum(greatest(quantity - received_quantity, 0)), 0) into open_left from public.scm_po_lines where po_id = po.id;
    update public.scm_purchase_orders
      set status = case when open_left <= 0 then 'received' else 'partial' end,
          received_on = case when open_left <= 0 then p_received_on else received_on end
      where id = po.id;
    return case when open_left <= 0 then 'received' else 'partial' end;
  end $fn$;

  -- A physical count: the ledger records the difference.
  create or replace function public.scm_count_stock(p_item uuid, p_location uuid, p_counted numeric, p_on date default current_date, p_note text default null)
  returns numeric language plpgsql security invoker set search_path = public as $fn$
  declare
    space uuid;
    current_on_hand numeric;
    delta numeric;
  begin
    if p_counted is null or p_counted < 0 then raise exception 'Counted quantity must be zero or more'; end if;
    select activity_space_id into space from public.scm_items where id = p_item;
    if space is null then raise exception 'Item not found'; end if;
    select on_hand into current_on_hand from public.scm_stock where item_id = p_item and location_id = p_location for update;
    delta := p_counted - coalesce(current_on_hand, 0);
    if delta <> 0 then
      insert into public.scm_movements (activity_space_id, item_id, location_id, kind, quantity, occurred_on, note)
      values (space, p_item, p_location, 'adjust', delta, p_on, coalesce(p_note, 'Stock count'));
    elsif current_on_hand is null then
      insert into public.scm_stock (activity_space_id, item_id, location_id, on_hand) values (space, p_item, p_location, 0);
    end if;
    return delta;
  end $fn$;

  revoke all on function public.scm_receive_po(uuid, jsonb, date) from public, anon;
  revoke all on function public.scm_count_stock(uuid, uuid, numeric, date, text) from public, anon;
  grant execute on function public.scm_receive_po(uuid, jsonb, date) to authenticated;
  grant execute on function public.scm_count_stock(uuid, uuid, numeric, date, text) to authenticated;
  $ddl$;
end $$;
