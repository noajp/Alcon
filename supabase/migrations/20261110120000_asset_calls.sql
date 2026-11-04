-- Work handed to an asset (asset relay, ADR 0036): an agent run asks a
-- runner on someone's own computer to do one thing — open a page in its
-- browser, read it, click — and the runner answers. The runner only ever
-- calls out (asset-relay /calls/next and /calls/:id/result), so nothing on
-- that computer is reachable from outside.
--
--   asset_calls   one row per call: the tool, its input, and the answer.
--                 run-agent writes the call and reads the answer with the
--                 service role; the relay hands it to the asset and records
--                 the answer. Members of the asset's Space read them (the
--                 run's audit trail); nobody else writes.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.assets') is null or to_regclass('public.agent_runs') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'asset calls skipped: assets, agent_runs or the Space helper not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.asset_calls (
      id uuid primary key default gen_random_uuid(),
      asset_id uuid not null references public.assets(id) on delete cascade,
      run_id uuid references public.agent_runs(id) on delete cascade,
      tool text not null check (char_length(btrim(tool)) between 1 and 60),
      input jsonb not null default '{}'::jsonb,
      status text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'failed', 'expired')),
      result jsonb,
      error text,
      created_at timestamptz not null default now(),
      claimed_at timestamptz,
      finished_at timestamptz
    )
  $ddl$;
  execute 'create index if not exists asset_calls_queue_idx on public.asset_calls (asset_id, status, created_at)';
  execute 'create index if not exists asset_calls_run_idx on public.asset_calls (run_id, created_at)';
  execute 'alter table public.asset_calls enable row level security';
  execute 'revoke all on table public.asset_calls from public, anon, authenticated';
  execute 'grant select on public.asset_calls to authenticated';
  execute 'drop policy if exists asset_calls_select on public.asset_calls';
  execute $ddl$
    create policy asset_calls_select on public.asset_calls for select to authenticated
      using (exists (select 1 from public.assets a where a.id = asset_id and public.is_activity_space_member(a.activity_space_id)))
  $ddl$;
end $$;
