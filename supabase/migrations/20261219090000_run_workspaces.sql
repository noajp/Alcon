-- Governed workspaces (coding capability PR1): the provisioning
-- record for a run's machine, and the server-side accept for the
-- asset a provisioned workspace announces as.
--
--   run_workspaces  one row per workspace binding: the run, the
--                   Space, the provider and its sandbox id, the
--                   class (managed: provisioned per run by the
--                   server; standing: a runner on the person's own
--                   infrastructure that a definition allowed), the
--                   egress as declared and as made effective, the
--                   caps it lived under, its deadline, its estimated
--                   cost, and how the story ended. The row is the
--                   audit (design §7): every vm_* call is already in
--                   asset_calls and the run's steps; this record is
--                   what says the machine they ran on was governed.
--                   Members of the Space read; only the service role
--                   writes (provisioning is a server act).
--
--   provision_asset service role only: creates an asset already
--                   active, claimed by the run's starter, its
--                   manifest carrying the provisioned block that
--                   binds it to its run. The relay's accept step,
--                   performed by the server for server-provisioned
--                   assets and recorded as such (an asset_events
--                   row, kind 'provisioned'); the owners are not
--                   asked to accept a machine the platform itself
--                   made for one run and will destroy at its end.
--
-- Guarded for preview replay (the base schema lives outside this
-- folder).

do $$
begin
  if to_regclass('public.agent_runs') is null
     or to_regclass('public.assets') is null
     or to_regclass('public.asset_events') is null
     or to_regclass('public.activity_spaces') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'run workspaces skipped: agent_runs, assets, asset_events, activity_spaces or the Space helper not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.run_workspaces (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references public.agent_runs(id) on delete cascade,
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      provider text not null default 'sprites',
      class text not null default 'managed' check (class in ('managed', 'standing')),
      status text not null default 'provisioning' check (status in ('provisioning', 'ready', 'destroyed', 'failed', 'expired')),
      sandbox_id text,
      asset_id uuid references public.assets(id) on delete set null,
      egress_declared jsonb not null default '[]'::jsonb,
      egress_effective jsonb not null default '[]'::jsonb,
      egress_enforced boolean not null default false,
      credential_free text not null default 'server' check (credential_free in ('server', 'self-reported')),
      caps jsonb not null default '{}'::jsonb,
      deadline timestamptz,
      cost_usd numeric,
      error text,
      destroy_reason text,
      created_at timestamptz not null default now(),
      ready_at timestamptz,
      destroyed_at timestamptz
    )
  $ddl$;
  execute 'create index if not exists run_workspaces_run_idx on public.run_workspaces (run_id, created_at desc)';
  execute 'create index if not exists run_workspaces_space_live_idx on public.run_workspaces (activity_space_id, status, created_at desc)';
  -- One live binding per run: a retried slice finds the workspace
  -- its first slice provisioned instead of minting a second one.
  execute 'create unique index if not exists run_workspaces_one_live_per_run on public.run_workspaces (run_id) where status in (''provisioning'', ''ready'')';
  execute 'alter table public.run_workspaces enable row level security';
  execute 'revoke all on table public.run_workspaces from public, anon, authenticated';
  execute 'grant select on public.run_workspaces to authenticated';
  execute 'drop policy if exists run_workspaces_select on public.run_workspaces';
  execute $ddl$
    create policy run_workspaces_select on public.run_workspaces for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $ddl$;

  execute $ddl$
    create or replace function public.provision_asset(
      p_space uuid, p_name text, p_manifest jsonb,
      p_token_hash text, p_token_prefix text, p_claimed_by uuid
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      v_id uuid;
      v_name text := left(btrim(coalesce(p_name, '')), 120);
    begin
      if not exists (select 1 from public.activity_spaces s where s.id = p_space) then
        raise exception 'space not found' using errcode = 'P0002';
      end if;
      if char_length(v_name) = 0 then
        raise exception 'name required' using errcode = '22023';
      end if;
      insert into public.assets (activity_space_id, name, kind, status, manifest, observed, token_hash, token_prefix, claimed_by, claimed_at, last_seen_at)
      values (p_space, v_name, 'ai_agent', 'active',
              coalesce(p_manifest, '{}'::jsonb), '{"provisioned": true}'::jsonb,
              p_token_hash, p_token_prefix, p_claimed_by, now(), now())
      returning id into v_id;
      insert into public.asset_events (asset_id, kind, summary)
      values (v_id, 'provisioned', 'Provisioned by the server as a per-run workspace; accepted on its behalf and bound to its run alone');
      return v_id;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.provision_asset(uuid, text, jsonb, text, text, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.provision_asset(uuid, text, jsonb, text, text, uuid) to service_role';
end $$;
