-- Agent engine v2: the tables an Element-executing agent needs to act on a
-- person's behalf and be checked doing it (ADR 0027).
--
--   agent_runs        + transcript / mode / prompt / usage / space, so a run
--                       can stop for approval and resume, and its cost counts
--                       against the Space's monthly budget
--   agent_actions     one row per proposal that needs a person's yes before it
--                       runs (an external write, or a batch of them), bound
--                       to the exact input
--   agent_artifacts   what an agent produced, readable by everyone who can
--                       see the Element (notes are personal, so not there)
--   integrations      external services a Space connects (MCP / HTTP API);
--                       secrets live in Vault, never in this table
--   activity_spaces   + ai_monthly_budget_usd
--
-- agent_runs / agent_run_steps were readable and writable by any signed-in
-- user; they now follow the Element's visibility like element_activity.
-- Guarded for preview replay: every block checks its dependencies first.
do $$
begin
  if to_regclass('public.agent_runs') is null
     or to_regclass('public.elements') is null
     or to_regprocedure('public.user_can_see_element(uuid)') is null then
    raise notice 'agent_engine_v2 skipped: agent_runs / elements / user_can_see_element not present';
    return;
  end if;

  -- ── agent_runs: resumable, metered ────────────────────────────────────
  alter table public.agent_runs add column if not exists mode text not null default 'execute';
  alter table public.agent_runs add column if not exists prompt text;
  alter table public.agent_runs add column if not exists transcript jsonb;
  alter table public.agent_runs add column if not exists input_tokens integer not null default 0;
  alter table public.agent_runs add column if not exists output_tokens integer not null default 0;
  alter table public.agent_runs add column if not exists cost_usd numeric(12,6) not null default 0;
  alter table public.agent_runs add column if not exists activity_space_id uuid;
  alter table public.agent_runs add column if not exists continuation_count integer not null default 0;
  alter table public.agent_runs add column if not exists reply_to uuid;
  create index if not exists agent_runs_element_created_idx on public.agent_runs (element_id, created_at desc);
  create index if not exists agent_runs_space_created_idx on public.agent_runs (activity_space_id, created_at);

  -- The Space an Element lives in: Element → Object → Domain → Space.
  create or replace function public.element_space(p_element_id uuid)
  returns uuid language sql stable security definer set search_path = public as $f$
    select d.activity_space_id
    from public.elements e
    join public.objects o on o.id = e.object_id
    join public.domains d on d.id = o.domain_id
    where e.id = p_element_id
  $f$;

  create or replace function public.agent_runs_stamp_space()
  returns trigger language plpgsql security definer set search_path = public as $f$
  begin
    if new.activity_space_id is null then
      new.activity_space_id := public.element_space(new.element_id);
    end if;
    return new;
  end
  $f$;
  drop trigger if exists trg_agent_runs_stamp_space on public.agent_runs;
  create trigger trg_agent_runs_stamp_space before insert on public.agent_runs
    for each row execute function public.agent_runs_stamp_space();

  -- Visibility follows the Element. A browser may queue a run on an Element
  -- it can see and cancel one; everything else on the row (status, the
  -- transcript, usage and cost) is written by the run-agent Edge Function
  -- with the service role after it has authorized the caller, so a member
  -- cannot rewrite a run's cost to slip the Space's budget.
  revoke insert, update on public.agent_runs from authenticated;
  grant insert (element_id, domain_id, worker_id, triggered_from, triggered_by, status, mode, prompt, reply_to)
    on public.agent_runs to authenticated;
  grant update (status, finished_at) on public.agent_runs to authenticated;

  create or replace function public.agent_runs_guard_client()
  returns trigger language plpgsql set search_path = public as $f$
  begin
    if coalesce(auth.role(), '') <> 'authenticated' then
      return new;
    end if;
    if tg_op = 'INSERT' and new.status <> 'queued' then
      raise exception 'a run starts queued' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'cancelled' then
      raise exception 'a run can only be cancelled from the app' using errcode = '42501';
    end if;
    return new;
  end
  $f$;
  drop trigger if exists trg_agent_runs_guard_client on public.agent_runs;
  create trigger trg_agent_runs_guard_client before insert or update on public.agent_runs
    for each row execute function public.agent_runs_guard_client();

  drop policy if exists agent_runs_rw on public.agent_runs;
  drop policy if exists agent_runs_select on public.agent_runs;
  create policy agent_runs_select on public.agent_runs for select to authenticated
    using (public.user_can_see_element(element_id));
  drop policy if exists agent_runs_insert on public.agent_runs;
  create policy agent_runs_insert on public.agent_runs for insert to authenticated
    with check (public.user_can_see_element(element_id) and triggered_by = auth.uid());
  drop policy if exists agent_runs_update on public.agent_runs;
  create policy agent_runs_update on public.agent_runs for update to authenticated
    using (public.user_can_see_element(element_id))
    with check (public.user_can_see_element(element_id));

  if to_regclass('public.agent_run_steps') is not null then
    drop policy if exists agent_run_steps_rw on public.agent_run_steps;
    drop policy if exists agent_run_steps_select on public.agent_run_steps;
    create policy agent_run_steps_select on public.agent_run_steps for select to authenticated
      using (exists (select 1 from public.agent_runs r where r.id = run_id and public.user_can_see_element(r.element_id)));
    -- Steps are written by the Edge Function only.
    drop policy if exists agent_run_steps_insert on public.agent_run_steps;
  end if;

  -- ── agent_actions: what waits for a person's yes ──────────────────────
  create table if not exists public.agent_actions (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.agent_runs(id) on delete cascade,
    element_id uuid not null references public.elements(id) on delete cascade,
    tool_use_id text not null,
    tool text not null,
    input jsonb not null default '{}'::jsonb,
    input_hash text not null,
    summary text not null,
    integration_id uuid,
    status text not null default 'pending'
      check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
    decided_by uuid default null,
    decided_at timestamptz,
    decision_note text,
    result jsonb,
    created_at timestamptz not null default now()
  );
  create index if not exists agent_actions_run_idx on public.agent_actions (run_id, created_at);
  create index if not exists agent_actions_pending_idx on public.agent_actions (element_id) where status = 'pending';
  alter table public.agent_actions enable row level security;
  drop policy if exists agent_actions_select on public.agent_actions;
  create policy agent_actions_select on public.agent_actions for select to authenticated
    using (public.user_can_see_element(element_id));
  -- Created and decided only through the Edge Function, which checks the
  -- decision against the stored input hash before anything runs.

  -- ── agent_artifacts: deliverables everyone on the Element can read ────
  create table if not exists public.agent_artifacts (
    id uuid primary key default gen_random_uuid(),
    element_id uuid not null references public.elements(id) on delete cascade,
    run_id uuid references public.agent_runs(id) on delete set null,
    title text not null,
    content text not null default '',
    format text not null default 'markdown' check (format in ('markdown', 'text', 'csv', 'json', 'html')),
    created_by uuid default auth.uid(),
    author_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists agent_artifacts_element_idx on public.agent_artifacts (element_id, created_at desc);
  alter table public.agent_artifacts enable row level security;
  drop policy if exists agent_artifacts_select on public.agent_artifacts;
  create policy agent_artifacts_select on public.agent_artifacts for select to authenticated
    using (public.user_can_see_element(element_id));
  drop policy if exists agent_artifacts_insert on public.agent_artifacts;
  create policy agent_artifacts_insert on public.agent_artifacts for insert to authenticated
    with check (public.user_can_see_element(element_id));
  drop policy if exists agent_artifacts_update on public.agent_artifacts;
  create policy agent_artifacts_update on public.agent_artifacts for update to authenticated
    using (public.user_can_see_element(element_id))
    with check (public.user_can_see_element(element_id));
  drop policy if exists agent_artifacts_delete on public.agent_artifacts;
  create policy agent_artifacts_delete on public.agent_artifacts for delete to authenticated
    using (public.user_can_see_element(element_id));

  -- ── Budget ────────────────────────────────────────────────────────────
  if to_regclass('public.activity_spaces') is not null then
    alter table public.activity_spaces add column if not exists ai_monthly_budget_usd numeric(10,2) not null default 20;
  end if;

  -- This month's agent spend in a Space, for members of that Space.
  create or replace function public.space_ai_spend_this_month(p_space_id uuid)
  returns numeric language plpgsql stable security definer set search_path = public as $f$
  begin
    if p_space_id is null or not public.is_activity_space_member(p_space_id) then
      return null;
    end if;
    return coalesce((
      select sum(cost_usd) from public.agent_runs
      where activity_space_id = p_space_id and created_at >= date_trunc('month', now())
    ), 0);
  end
  $f$;

  -- ── Integrations ──────────────────────────────────────────────────────
  if to_regclass('public.activity_spaces') is not null
     and to_regprocedure('public.is_activity_space_member(uuid)') is not null
     and to_regprocedure('public.is_activity_space_owner(uuid)') is not null then
    create table if not exists public.integrations (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      preset text,
      kind text not null check (kind in ('mcp', 'http')),
      name text not null,
      description text,
      icon text,
      endpoint text not null,
      auth_type text not null default 'bearer' check (auth_type in ('none', 'bearer', 'header', 'oauth')),
      auth_header text,
      secret_id uuid,
      delegation text not null default 'approve_each' check (delegation in ('approve_each', 'full_delegation')),
      enabled boolean not null default true,
      last_test jsonb,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists integrations_space_idx on public.integrations (activity_space_id);
    alter table public.integrations enable row level security;
    drop policy if exists integrations_select on public.integrations;
    create policy integrations_select on public.integrations for select to authenticated
      using (public.is_activity_space_member(activity_space_id));
    drop policy if exists integrations_insert on public.integrations;
    create policy integrations_insert on public.integrations for insert to authenticated
      with check (public.is_activity_space_owner(activity_space_id));
    drop policy if exists integrations_update on public.integrations;
    create policy integrations_update on public.integrations for update to authenticated
      using (public.is_activity_space_owner(activity_space_id))
      with check (public.is_activity_space_owner(activity_space_id));
    drop policy if exists integrations_delete on public.integrations;
    create policy integrations_delete on public.integrations for delete to authenticated
      using (public.is_activity_space_owner(activity_space_id));
  end if;

  begin alter publication supabase_realtime add table public.agent_runs; exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.agent_run_steps; exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.agent_actions; exception when duplicate_object or undefined_object then null; end;
  begin alter publication supabase_realtime add table public.agent_artifacts; exception when duplicate_object or undefined_object then null; end;
end
$$;

-- Integration secrets go through Vault. Owners write them through
-- set_integration_secret; only the service role (Edge Functions) can read
-- them back, through get_integration_secret. Neither ever returns the secret
-- to a browser. Skipped where Vault or integrations is absent.
do $$
begin
  if to_regclass('public.integrations') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'integration secrets skipped: integrations or vault not present';
    return;
  end if;

  create or replace function public.set_integration_secret(p_integration_id uuid, p_secret text)
  returns void language plpgsql security definer set search_path = public, vault as $f$
  declare
    v_space uuid;
    v_secret_id uuid;
  begin
    select activity_space_id, secret_id into v_space, v_secret_id
    from public.integrations where id = p_integration_id;
    if v_space is null or not public.is_activity_space_owner(v_space) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if p_secret is null or length(p_secret) = 0 then
      update public.integrations set secret_id = null, updated_at = now() where id = p_integration_id;
      if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
      return;
    end if;
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_secret, 'integration:' || p_integration_id::text, 'Alcon integration credential');
      update public.integrations set secret_id = v_secret_id, updated_at = now() where id = p_integration_id;
    else
      perform vault.update_secret(v_secret_id, p_secret);
      update public.integrations set updated_at = now() where id = p_integration_id;
    end if;
  end
  $f$;
  revoke all on function public.set_integration_secret(uuid, text) from public;
  grant execute on function public.set_integration_secret(uuid, text) to authenticated;

  create or replace function public.get_integration_secret(p_integration_id uuid)
  returns text language sql stable security definer set search_path = public, vault as $f$
    select ds.decrypted_secret
    from public.integrations i
    join vault.decrypted_secrets ds on ds.id = i.secret_id
    where i.id = p_integration_id
  $f$;
  revoke all on function public.get_integration_secret(uuid) from public;
  revoke all on function public.get_integration_secret(uuid) from authenticated;
  revoke all on function public.get_integration_secret(uuid) from anon;
  grant execute on function public.get_integration_secret(uuid) to service_role;
end
$$;
