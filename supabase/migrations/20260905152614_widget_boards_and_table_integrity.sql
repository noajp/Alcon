-- Personal arrangements, addressable by humans and agents using the same JWT.
create table if not exists public.widget_boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  board_key text not null check (length(board_key) between 1 and 200),
  layout jsonb not null check (coalesce((
    jsonb_typeof(layout) = 'object' and layout->'version' = '2'::jsonb
    and jsonb_typeof(layout->'zones') = 'object'
    and jsonb_typeof(layout->'zones'->'band') = 'array'
    and jsonb_typeof(layout->'zones'->'main') = 'array'
    and jsonb_typeof(layout->'zones'->'rail') = 'array'
  ), false)),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  unique(owner_id, board_key)
);
alter table public.widget_boards enable row level security;
revoke all on public.widget_boards from anon;
grant select, insert, update, delete on public.widget_boards to authenticated;
grant all on public.widget_boards to service_role;
create policy widget_boards_owner on public.widget_boards for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

create or replace function public.widget_board_revision() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id or new.board_key is distinct from old.board_key then
    raise exception 'Board identity cannot be changed';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger widget_board_revision before update on public.widget_boards
for each row execute function public.widget_board_revision();

-- A cell belongs to one Table even when an API caller supplies the IDs.
-- Also disallow moving columns/rows, which would invalidate existing cells.
do $migration$
begin
  if to_regclass('public.tables') is null or to_regclass('public.table_rows') is null
     or to_regclass('public.table_columns') is null or to_regclass('public.table_cells') is null then
    raise notice 'Table integrity skipped: base schema absent';
    return;
  end if;
  execute $ddl$
    create or replace function public.table_cell_same_table() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if not exists (
        select 1 from public.table_rows r join public.table_columns c on c.table_id = r.table_id
        where r.id = new.row_id and c.id = new.column_id
      ) then raise exception 'Cell row and column must belong to the same accessible Table'; end if;
      return new;
    end;
    $fn$
  $ddl$;
  execute 'create trigger table_cell_same_table before insert or update on public.table_cells for each row execute function public.table_cell_same_table()';
  execute $ddl$
    create or replace function public.table_member_identity() returns trigger
    language plpgsql set search_path = '' as $fn$
    begin
      if new.table_id is distinct from old.table_id then raise exception 'Table membership cannot be changed'; end if;
      return new;
    end;
    $fn$
  $ddl$;
  execute 'create trigger table_row_identity before update on public.table_rows for each row execute function public.table_member_identity()';
  execute 'create trigger table_column_identity before update on public.table_columns for each row execute function public.table_member_identity()';
end;
$migration$;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['widget_boards','tables','table_columns','table_rows','table_cells'] loop
      if to_regclass('public.' || t) is not null and not exists (
        select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then execute format('alter publication supabase_realtime add table public.%I', t); end if;
    end loop;
  end if;
end;
$$;
