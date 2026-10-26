-- The AI audit ledger (ADR 0044): what an AI did in a customer's business,
-- kept without the business documents themselves.
--
--   workflow_templates    a business process an agent runs (受注の転記…): its
--                         purpose and steps, one row per version. Shared
--                         across Spaces; written by the operator, read by all
--   workflow_deployments  a template running in a Space: which Domain (the
--                         department), which Object holds its exceptions,
--                         which ai_agent Worker runs it, and its state
--   workflow_runs         one run of a deployment on one document — the
--                         document's number and a keyed digest, never its body
--   workflow_run_steps    what happened at each joint of a run (which
--                         connector, which operation, the result), as events
--
-- Runs and steps are append-only for everyone, the service role included:
-- an UPDATE or DELETE raises, except the cascade that removes a whole Space.
-- Steps form one hash chain per deployment, computed here on insert, so a
-- removed or altered event shows as a break no matter who wrote the row.
-- Rows are written by the ingest function (service role); the app only reads.
-- Guarded for preview replay: every block checks its dependencies first.
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.domains') is null
     or to_regclass('public.objects') is null
     or to_regclass('public.workers') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('public.user_can_see_domain(uuid)') is null
     or to_regprocedure('public.user_is_domain_member(uuid)') is null then
    raise notice 'workflow_audit_ledger skipped: spaces / domains / objects / workers or their access functions not present';
    return;
  end if;

  execute 'create extension if not exists pgcrypto with schema extensions';

  -- ── templates ──────────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.workflow_templates (
      id uuid primary key default gen_random_uuid(),
      key text not null,
      version integer not null default 1 check (version > 0),
      name text not null,
      purpose text not null default '',
      steps jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
      created_at timestamptz not null default now(),
      unique (key, version)
    )
  $ddl$;
  execute 'alter table public.workflow_templates enable row level security';
  execute 'drop policy if exists workflow_templates_read on public.workflow_templates';
  execute 'create policy workflow_templates_read on public.workflow_templates for select to authenticated using (true)';

  -- ── deployments ────────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.workflow_deployments (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      template_id uuid not null references public.workflow_templates(id) on delete restrict,
      name text not null,
      domain_id uuid references public.domains(id) on delete set null,
      object_id uuid references public.objects(id) on delete set null,
      worker_id uuid references public.workers(id) on delete set null,
      state text not null default 'trial' check (state in ('trial', 'live', 'paused')),
      minutes_per_item numeric(8,2) check (minutes_per_item is null or minutes_per_item >= 0),
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists workflow_deployments_space_idx on public.workflow_deployments (activity_space_id)';
  execute 'alter table public.workflow_deployments enable row level security';

  -- Whether the caller may read a deployment and its records: a member of
  -- its Space, and — when it belongs to a Domain — someone who can see that
  -- Domain (its viewers included).
  execute $fn$
    create or replace function public.user_can_see_deployment(_deployment_id uuid)
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (
        select 1 from workflow_deployments d
        where d.id = _deployment_id
          and public.is_activity_space_member(d.activity_space_id)
          and (d.domain_id is null
               or public.user_can_see_domain(d.domain_id)
               or public.user_is_domain_member(d.domain_id))
      );
    $b$
  $fn$;
  execute 'revoke all on function public.user_can_see_deployment(uuid) from public';
  execute 'grant execute on function public.user_can_see_deployment(uuid) to authenticated';

  execute 'drop policy if exists workflow_deployments_read on public.workflow_deployments';
  execute 'create policy workflow_deployments_read on public.workflow_deployments for select to authenticated using (public.user_can_see_deployment(id))';
  -- The Space's owner registers and pauses deployments. A deployment is
  -- never deleted from the app: pausing keeps its records reachable.
  execute 'drop policy if exists workflow_deployments_owner_insert on public.workflow_deployments';
  execute 'create policy workflow_deployments_owner_insert on public.workflow_deployments for insert to authenticated with check (public.is_activity_space_owner(activity_space_id))';
  execute 'drop policy if exists workflow_deployments_owner_update on public.workflow_deployments';
  execute 'create policy workflow_deployments_owner_update on public.workflow_deployments for update to authenticated using (public.is_activity_space_owner(activity_space_id)) with check (public.is_activity_space_owner(activity_space_id))';

  -- ── runs ───────────────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.workflow_runs (
      id uuid primary key default gen_random_uuid(),
      deployment_id uuid not null references public.workflow_deployments(id) on delete cascade,
      activity_space_id uuid not null,
      external_id text not null,
      template_version integer not null,
      subject_ref text,
      subject_digest text,
      started_at timestamptz not null,
      received_at timestamptz not null default now(),
      unique (deployment_id, external_id)
    )
  $ddl$;
  execute 'create index if not exists workflow_runs_deployment_idx on public.workflow_runs (deployment_id, started_at desc)';
  execute 'alter table public.workflow_runs enable row level security';
  execute 'drop policy if exists workflow_runs_read on public.workflow_runs';
  execute 'create policy workflow_runs_read on public.workflow_runs for select to authenticated using (public.user_can_see_deployment(deployment_id))';

  -- ── steps ──────────────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.workflow_run_steps (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references public.workflow_runs(id) on delete cascade,
      deployment_id uuid not null,
      activity_space_id uuid not null,
      step_key text not null,
      kind text not null check (kind in ('start', 'step', 'approval', 'exception', 'end')),
      connector text,
      operation text not null default 'none' check (operation in ('read', 'draft', 'send', 'money', 'none')),
      result text not null check (result in ('ok', 'failed', 'blocked', 'waiting', 'approved', 'returned')),
      actor_kind text not null check (actor_kind in ('ai_agent', 'human', 'system')),
      actor_name text,
      reason text,
      occurred_at timestamptz not null,
      duration_ms integer check (duration_ms is null or duration_ms >= 0),
      seq bigint not null,
      prev_hash text not null,
      hash text not null,
      received_at timestamptz not null default now(),
      unique (deployment_id, seq)
    )
  $ddl$;
  execute 'create index if not exists workflow_run_steps_run_idx on public.workflow_run_steps (run_id, seq)';
  execute 'alter table public.workflow_run_steps enable row level security';
  execute 'drop policy if exists workflow_run_steps_read on public.workflow_run_steps';
  execute 'create policy workflow_run_steps_read on public.workflow_run_steps for select to authenticated using (public.user_can_see_deployment(deployment_id))';

  -- A run belongs to its deployment's Space, whatever the writer claimed.
  execute $fn$
    create or replace function public.workflow_run_stamp()
    returns trigger language plpgsql security definer set search_path = public as $b$
    begin
      select d.activity_space_id into new.activity_space_id
      from workflow_deployments d where d.id = new.deployment_id;
      if new.activity_space_id is null then
        raise exception 'workflow run: unknown deployment %', new.deployment_id;
      end if;
      return new;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists workflow_run_stamp on public.workflow_runs';
  execute 'create trigger workflow_run_stamp before insert on public.workflow_runs for each row execute function public.workflow_run_stamp()';

  -- A step takes its run's deployment and Space, and the next link of the
  -- deployment's chain. Locking the deployment row serialises concurrent
  -- writers, so two steps never claim the same seq or the same prev_hash.
  -- The hashed text is fixed field by field (Function/audit/auditModel.ts
  -- `stepChainText` reads it the same way, for verification).
  execute $fn$
    create or replace function public.workflow_step_chain()
    returns trigger language plpgsql security definer set search_path = public, extensions as $b$
    declare
      last_seq bigint;
      last_hash text;
    begin
      select r.deployment_id, r.activity_space_id into new.deployment_id, new.activity_space_id
      from workflow_runs r where r.id = new.run_id;
      if new.deployment_id is null then
        raise exception 'workflow step: unknown run %', new.run_id;
      end if;
      perform 1 from workflow_deployments where id = new.deployment_id for update;
      select s.seq, s.hash into last_seq, last_hash
      from workflow_run_steps s where s.deployment_id = new.deployment_id
      order by s.seq desc limit 1;
      new.seq := coalesce(last_seq, 0) + 1;
      new.prev_hash := coalesce(last_hash, repeat('0', 64));
      new.hash := encode(extensions.digest(concat_ws('|',
        new.prev_hash, new.seq::text, new.run_id::text, new.step_key, new.kind,
        coalesce(new.connector, ''), new.operation, new.result, new.actor_kind,
        coalesce(new.actor_name, ''), coalesce(new.reason, ''),
        to_char(new.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        coalesce(new.duration_ms::text, '')
      ), 'sha256'), 'hex');
      return new;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists workflow_step_chain on public.workflow_run_steps';
  execute 'create trigger workflow_step_chain before insert on public.workflow_run_steps for each row execute function public.workflow_step_chain()';

  -- Append-only. A cascade (removing the Space, and with it the deployment)
  -- arrives from a referential-integrity trigger, one level deeper than a
  -- statement aimed at the table itself.
  execute $fn$
    create or replace function public.workflow_records_append_only()
    returns trigger language plpgsql as $b$
    begin
      if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
        return old;
      end if;
      raise exception 'workflow audit records are append-only (% on %)', tg_op, tg_table_name;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists workflow_runs_append_only on public.workflow_runs';
  execute 'create trigger workflow_runs_append_only before update or delete on public.workflow_runs for each row execute function public.workflow_records_append_only()';
  execute 'drop trigger if exists workflow_run_steps_append_only on public.workflow_run_steps';
  execute 'create trigger workflow_run_steps_append_only before update or delete on public.workflow_run_steps for each row execute function public.workflow_records_append_only()';
  -- Deleting a deployment would take its records with it, so only the
  -- Space's own removal may.
  execute 'drop trigger if exists workflow_deployments_kept on public.workflow_deployments';
  execute 'create trigger workflow_deployments_kept before delete on public.workflow_deployments for each row execute function public.workflow_records_append_only()';

  execute $fn$
    create or replace function public.workflow_deployment_touch()
    returns trigger language plpgsql as $b$
    begin
      new.updated_at := now();
      new.activity_space_id := old.activity_space_id;
      new.template_id := old.template_id;
      return new;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists workflow_deployment_touch on public.workflow_deployments';
  execute 'create trigger workflow_deployment_touch before update on public.workflow_deployments for each row execute function public.workflow_deployment_touch()';
end $$;
