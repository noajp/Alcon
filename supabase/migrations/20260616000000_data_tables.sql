-- User-managed data tables ("Tables" feature) — Notion-DB / Airtable /
-- Supabase-Studio-style. Independent of D/O/E — each row is an end-user-owned
-- database scoped by `created_by` (the signed-in user). RLS lets each user
-- read/write only their own tables and cascades through the hierarchy.
--
-- Four tables in this schema family:
--   tables          — one row per user-defined database
--   table_columns   — schema definition (typed columns per table)
--   table_rows      — rows inside a table (no values here; just identity + order)
--   table_cells     — values per (row, column), stored as jsonb so any column
--                     type fits without per-type tables
--
-- The 'tables' name doesn't collide with Postgres reserved words because it's
-- in the `public` schema and uses lower-case. (Postgres reserves `TABLE` as a
-- keyword but not `tables` as an identifier.)
--
-- Idempotent — `create table if not exists` + policy `drop if exists ... create`,
-- so a fresh preview branch can replay the migrations folder safely.

create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  domain_id uuid references public.domains(id) on delete set null,
  name text not null,
  description text,
  icon text,
  color text,
  status text not null default 'active',
  order_index integer,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.table_columns (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete cascade,
  name text not null,
  type text not null check (type in ('text','number','date','select','checkbox')),
  options jsonb,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.table_rows (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables(id) on delete cascade,
  order_index integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.table_cells (
  row_id uuid not null references public.table_rows(id) on delete cascade,
  column_id uuid not null references public.table_columns(id) on delete cascade,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (row_id, column_id)
);

create index if not exists tables_created_by_idx on public.tables(created_by);
create index if not exists tables_domain_idx on public.tables(domain_id);
create index if not exists table_columns_table_idx on public.table_columns(table_id, order_index);
create index if not exists table_rows_table_idx on public.table_rows(table_id, order_index);
create index if not exists table_cells_row_idx on public.table_cells(row_id);

alter table public.tables enable row level security;
alter table public.table_columns enable row level security;
alter table public.table_rows enable row level security;
alter table public.table_cells enable row level security;

-- Owner-only access. Cells inherit the table's owner via the row → table chain
-- so the policy doesn't need a separate ownership column on every level.
drop policy if exists tables_owner on public.tables;
create policy tables_owner on public.tables
  for all using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists table_columns_owner on public.table_columns;
create policy table_columns_owner on public.table_columns
  for all using (
    exists (select 1 from public.tables t where t.id = table_id and t.created_by = auth.uid())
  ) with check (
    exists (select 1 from public.tables t where t.id = table_id and t.created_by = auth.uid())
  );

drop policy if exists table_rows_owner on public.table_rows;
create policy table_rows_owner on public.table_rows
  for all using (
    exists (select 1 from public.tables t where t.id = table_id and t.created_by = auth.uid())
  ) with check (
    exists (select 1 from public.tables t where t.id = table_id and t.created_by = auth.uid())
  );

drop policy if exists table_cells_owner on public.table_cells;
create policy table_cells_owner on public.table_cells
  for all using (
    exists (
      select 1 from public.table_rows r
      join public.tables t on t.id = r.table_id
      where r.id = row_id and t.created_by = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.table_rows r
      join public.tables t on t.id = r.table_id
      where r.id = row_id and t.created_by = auth.uid()
    )
  );
