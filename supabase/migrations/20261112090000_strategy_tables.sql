-- The things a Strategy is about, kept as Tables (the candidate houses, the
-- vendors): an agent saves what it found as rows, and later work reads and
-- narrows them.
--
--   tables.strategy_id   the Strategy a Table is about. Its runs list it
--                        and save into it.
--   agent_table_reads    which Element's run read which Table, and when. A
--                        change to the Table after that Element is done
--                        tells it to look again. Written and read only by
--                        run-agent with the service role.
--
-- Read by run-agent (supabase/functions/run-agent/recordStore.ts).
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.tables') is null or to_regclass('public.strategies') is null or to_regclass('public.elements') is null then
    raise notice 'strategy tables skipped: base tables not present'; return;
  end if;
  execute 'alter table public.tables add column if not exists strategy_id uuid references public.strategies(id) on delete set null';
  execute 'create index if not exists tables_strategy_id_idx on public.tables(strategy_id) where strategy_id is not null';
  execute $sql$
    create table if not exists public.agent_table_reads (
      element_id uuid not null references public.elements(id) on delete cascade,
      table_id uuid not null references public.tables(id) on delete cascade,
      run_id uuid,
      read_at timestamptz not null default now(),
      primary key (element_id, table_id)
    )
  $sql$;
  execute 'alter table public.agent_table_reads enable row level security';
  execute 'revoke all on public.agent_table_reads from anon, authenticated';
  execute 'create index if not exists agent_table_reads_table_idx on public.agent_table_reads(table_id)';
end $$;
