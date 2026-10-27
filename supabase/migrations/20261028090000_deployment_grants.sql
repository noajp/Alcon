-- Grants for the AI audit ledger (ADR 0046): what each deployment may do,
-- decided in Alcon and enforced by the gateway.
--
--   deployment_grants          the grants in force: one row per connector and
--                              operation (read / draft / send / money) a
--                              deployment may use. Only the Space's owner,
--                              signed in themselves, adds or removes one
--   deployment_grant_versions  every state the grants have been in, numbered
--                              per deployment, written by the database on each
--                              change. The gateway holds a version; its
--                              records name it; the intake judges them by it
--   workflow_run_steps         gains the version the gateway held for the
--                              step (grants_version) and whether the step's
--                              operation was outside it (outside_grant)
--
-- workflow_grants_table hands audit-grants a key's Space's latest versions;
-- the function signs them with Alcon's key for the gateway.
-- Guarded for preview replay: the ledger and the intake may be absent.
do $$
begin
  if to_regclass('public.workflow_deployments') is null
     or to_regclass('public.workflow_run_steps') is null
     or to_regclass('public.workflow_gateway_keys') is null
     or to_regclass('public.workflow_intake_batches') is null
     or to_regprocedure('public.user_can_see_deployment(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('public.is_delegated_request()') is null
     or to_regprocedure('public.workflow_records_append_only()') is null then
    raise notice 'deployment_grants skipped: the audit ledger, its intake or their access functions not present';
    return;
  end if;

  -- ── grants in force ────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.deployment_grants (
      deployment_id uuid not null references public.workflow_deployments(id) on delete cascade,
      activity_space_id uuid not null,
      connector text not null check (char_length(connector) between 1 and 200 and connector = btrim(connector)),
      operation text not null check (operation in ('read', 'draft', 'send', 'money')),
      created_by uuid,
      created_at timestamptz not null default now(),
      primary key (deployment_id, connector, operation)
    )
  $ddl$;
  execute 'alter table public.deployment_grants enable row level security';
  execute 'drop policy if exists deployment_grants_read on public.deployment_grants';
  execute 'create policy deployment_grants_read on public.deployment_grants for select to authenticated using (public.user_can_see_deployment(deployment_id))';
  -- A delegated call (a personal access token or an OAuth grant, which is how
  -- an outside agent acts for a person) never changes grants: an agent must
  -- not be able to widen what it, or another agent, may do.
  execute 'drop policy if exists deployment_grants_owner_insert on public.deployment_grants';
  execute 'create policy deployment_grants_owner_insert on public.deployment_grants for insert to authenticated with check (public.is_activity_space_owner(activity_space_id) and not public.is_delegated_request())';
  execute 'drop policy if exists deployment_grants_owner_delete on public.deployment_grants';
  execute 'create policy deployment_grants_owner_delete on public.deployment_grants for delete to authenticated using (public.is_activity_space_owner(activity_space_id) and not public.is_delegated_request())';

  -- A grant takes its deployment's Space and its author from the database,
  -- needs a signed-in person, and is never edited: a change is a removal and
  -- an addition.
  execute $fn$
    create or replace function public.deployment_grant_stamp()
    returns trigger language plpgsql security definer set search_path = public as $b$
    begin
      if tg_op = 'UPDATE' then
        raise exception 'deployment grants are added or removed, not edited';
      end if;
      if auth.uid() is null or public.is_delegated_request() then
        raise exception 'deployment grants are changed only by a signed-in person';
      end if;
      select d.activity_space_id into new.activity_space_id from workflow_deployments d where d.id = new.deployment_id;
      new.created_by := auth.uid();
      new.created_at := now();
      return new;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists deployment_grant_stamp on public.deployment_grants';
  execute 'create trigger deployment_grant_stamp before insert or update on public.deployment_grants for each row execute function public.deployment_grant_stamp()';

  -- ── versions ───────────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.deployment_grant_versions (
      deployment_id uuid not null references public.workflow_deployments(id) on delete cascade,
      activity_space_id uuid not null,
      version integer not null check (version > 0),
      grants jsonb not null check (jsonb_typeof(grants) = 'array'),
      changed_by uuid,
      created_at timestamptz not null default now(),
      primary key (deployment_id, version)
    )
  $ddl$;
  execute 'alter table public.deployment_grant_versions enable row level security';
  execute 'drop policy if exists deployment_grant_versions_read on public.deployment_grant_versions';
  execute 'create policy deployment_grant_versions_read on public.deployment_grant_versions for select to authenticated using (public.user_can_see_deployment(deployment_id))';
  execute 'drop trigger if exists deployment_grant_versions_append_only on public.deployment_grant_versions';
  execute 'create trigger deployment_grant_versions_append_only before update or delete on public.deployment_grant_versions for each row execute function public.workflow_records_append_only()';
  execute 'drop trigger if exists deployment_grant_versions_no_truncate on public.deployment_grant_versions';
  execute 'create trigger deployment_grant_versions_no_truncate before truncate on public.deployment_grant_versions for each statement execute function public.workflow_records_append_only()';

  -- After each statement that changed grants, every deployment it touched
  -- gets its next version — the grants now in force, sorted — unless they
  -- are what the latest version already says. The deployment's row is
  -- locked first, so two owners changing grants at once get two versions in
  -- order, never one number twice. The lock is FOR NO KEY UPDATE: each
  -- inserting statement already holds FOR KEY SHARE on the row (the foreign
  -- key check), which FOR UPDATE would wait on and deadlock against. A
  -- deployment removed with its Space gets none.
  execute $fn$
    create or replace function public.deployment_grants_version()
    returns trigger language plpgsql security definer set search_path = public as $b$
    declare
      dep uuid;
      space uuid;
      snapshot jsonb;
      latest jsonb;
      latest_version integer;
    begin
      for dep in select distinct deployment_id from changed order by 1 loop
        select activity_space_id into space from workflow_deployments where id = dep for no key update;
        continue when space is null;
        select coalesce(jsonb_agg(jsonb_build_object('connector', g.connector, 'operation', g.operation)
                 order by g.connector, g.operation), '[]'::jsonb)
          into snapshot from deployment_grants g where g.deployment_id = dep;
        latest := null;
        latest_version := null;
        select v.grants, v.version into latest, latest_version from deployment_grant_versions v
        where v.deployment_id = dep order by v.version desc limit 1;
        continue when latest is not distinct from snapshot;
        insert into deployment_grant_versions (deployment_id, activity_space_id, version, grants, changed_by)
        values (dep, space, coalesce(latest_version, 0) + 1, snapshot, auth.uid());
      end loop;
      return null;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists deployment_grants_version_insert on public.deployment_grants';
  execute 'create trigger deployment_grants_version_insert after insert on public.deployment_grants referencing new table as changed for each statement execute function public.deployment_grants_version()';
  execute 'drop trigger if exists deployment_grants_version_delete on public.deployment_grants';
  execute 'create trigger deployment_grants_version_delete after delete on public.deployment_grants referencing old table as changed for each statement execute function public.deployment_grants_version()';

  -- ── what the gateway saw ───────────────────────────────────────────────
  execute 'alter table public.workflow_run_steps add column if not exists grants_version integer';
  execute 'alter table public.workflow_run_steps add column if not exists outside_grant boolean not null default false';

  -- Whether an operation was outside the grants the gateway said it held:
  -- that version does not exist, does not include this connector and
  -- operation, or — for send and money, which stop when the gateway's table
  -- expires — had been replaced for longer than a table lives
  -- (_shared/auditGrants.ts GRANTS_TTL_SECONDS) when the step happened.
  execute $fn$
    create or replace function public.workflow_step_outside_grant(_deployment_id uuid, _connector text, _operation text, _version integer, _occurred_at timestamptz)
    returns boolean language plpgsql stable security definer set search_path = public as $b$
    declare
      held jsonb;
    begin
      if _operation is null or _operation = 'none' then return false; end if;
      if _version is null or _connector is null then return true; end if;
      select grants into held from deployment_grant_versions where deployment_id = _deployment_id and version = _version;
      if held is null then return true; end if;
      if not held @> jsonb_build_array(jsonb_build_object('connector', _connector, 'operation', _operation)) then return true; end if;
      if _operation in ('send', 'money') and exists (
        select 1 from deployment_grant_versions where deployment_id = _deployment_id and version = _version + 1
          and created_at < _occurred_at - interval '15 minutes') then
        return true;
      end if;
      return false;
    end;
    $b$
  $fn$;
  execute 'revoke all on function public.workflow_step_outside_grant(uuid, text, text, integer, timestamptz) from public, anon, authenticated';

  -- ── the table a gateway is handed ──────────────────────────────────────
  -- The latest version of every deployment in the key's Space (version 0 and
  -- no grants for one never granted anything), with the deployment's state;
  -- null for an unknown or revoked key.
  execute 'drop function if exists public.workflow_grants_table(uuid)';
  execute $fn$
    create function public.workflow_grants_table(_key_id uuid)
    returns jsonb
    language plpgsql stable security definer set search_path = public as $b$
    declare
      space uuid;
    begin
      select activity_space_id into space from workflow_gateway_keys where id = _key_id and revoked_at is null;
      if space is null then return null; end if;
      return jsonb_build_object(
        'space_id', space,
        'deployments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'deployment_id', d.id, 'state', d.state,
            'version', coalesce(v.version, 0), 'grants', coalesce(v.grants, '[]'::jsonb)) order by d.id)
          from workflow_deployments d
          left join lateral (
            select x.version, x.grants from deployment_grant_versions x
            where x.deployment_id = d.id order by x.version desc limit 1
          ) v on true
          where d.activity_space_id = space
        ), '[]'::jsonb));
    end;
    $b$
  $fn$;
  execute 'revoke all on function public.workflow_grants_table(uuid) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.workflow_grants_table(uuid) to service_role';
  end if;

  -- ── the intake judges each step by the grants it names ─────────────────
  execute 'drop function if exists public.workflow_intake(uuid, text, text, jsonb, jsonb)';
  execute $fn$
    create function public.workflow_intake(_key_id uuid, _batch_id text, _body_digest text, _runs jsonb, _steps jsonb)
    returns jsonb
    language plpgsql security definer set search_path = public as $b$
    declare
      genesis constant text := repeat('0', 64);
      key_space uuid;
      prior workflow_intake_batches%rowtype;
      problem text;
      dep uuid;
      tail text;
      r jsonb;
      s jsonb;
      stored workflow_run_steps%rowtype;
      existing workflow_runs%rowtype;
      the_run uuid;
      seen_new boolean;
      runs_added integer := 0;
      steps_added integer := 0;
    begin
      select activity_space_id into key_space from workflow_gateway_keys
      where id = _key_id and revoked_at is null;
      if key_space is null then
        return jsonb_build_object('status', 'rejected', 'reason', 'unknown or revoked key', 'key_revoked', true);
      end if;

      -- The same batch arriving twice at once: the second waits here.
      perform pg_advisory_xact_lock(hashtextextended(_key_id::text || '/' || _batch_id, 0));
      select * into prior from workflow_intake_batches
      where gateway_key_id = _key_id and batch_id = _batch_id and status = 'accepted';
      if prior.id is not null then
        if prior.body_digest = _body_digest then
          return jsonb_build_object('status', 'duplicate', 'runs_added', 0, 'steps_added', 0);
        end if;
        problem := 'batch id already accepted with different content';
      end if;

      -- Every deployment named is in the key's Space.
      if problem is null then
        select 'deployment ' || x.id || ' is not in this key''s Space' into problem
        from (
          select (e->>'deployment_id')::uuid as id from jsonb_array_elements(_runs) e
          union select (e->>'deployment_id')::uuid from jsonb_array_elements(_steps) e
        ) x
        where not exists (select 1 from workflow_deployments d where d.id = x.id and d.activity_space_id = key_space)
        limit 1;
      end if;

      -- Every deployment named is locked, in one order, before anything is
      -- compared: a concurrent batch for the same deployment waits here, and
      -- sees what this one wrote.
      if problem is null then
        perform 1 from workflow_deployments where id in (
          select (e->>'deployment_id')::uuid from jsonb_array_elements(_runs) e
          union select (e->>'deployment_id')::uuid from jsonb_array_elements(_steps) e
        ) order by id for update;
      end if;

      -- A run already held must be the same run.
      if problem is null then
        for r in select * from jsonb_array_elements(_runs) loop
          select * into existing from workflow_runs
          where deployment_id = (r->>'deployment_id')::uuid and external_id = r->>'external_id';
          if existing.id is not null and (
               existing.template_version <> (r->>'template_version')::integer
               or existing.subject_ref is distinct from r->>'subject_ref'
               or existing.subject_digest is distinct from r->>'subject_digest'
               or existing.started_at <> (r->>'started_at')::timestamptz) then
            problem := 'run ' || (r->>'external_id') || ' differs from the one already held';
            exit;
          end if;
        end loop;
      end if;

      -- Each deployment's events continue its chain: events already held
      -- (a resend) must match what was stored and come first; the first new
      -- one links to the last stored digest; the rest link to each other.
      if problem is null then
        for dep in
          select distinct (e->>'deployment_id')::uuid from jsonb_array_elements(_steps) e order by 1
        loop
          select gateway_digest into tail from workflow_run_steps
          where deployment_id = dep order by seq desc limit 1;
          tail := coalesce(tail, genesis);
          seen_new := false;
          for s in
            select e from jsonb_array_elements(_steps) with ordinality t(e, i)
            where (e->>'deployment_id')::uuid = dep order by i
          loop
            select * into stored from workflow_run_steps
            where deployment_id = dep and event_id = s->>'event_id';
            if stored.id is not null then
              if stored.gateway_digest is distinct from s->>'digest' then
                problem := 'event ' || (s->>'event_id') || ' differs from the one already held';
              elsif seen_new then
                problem := 'event ' || (s->>'event_id') || ' was already held but arrived after new events';
              end if;
            elsif s->>'prev_digest' is distinct from tail then
              problem := 'chain broken before event ' || (s->>'event_id') || ' of deployment ' || dep;
            else
              seen_new := true;
              tail := s->>'digest';
            end if;
            exit when problem is not null;
          end loop;
          exit when problem is not null;
        end loop;
      end if;

      if problem is not null then
        insert into workflow_intake_batches (gateway_key_id, activity_space_id, batch_id, body_digest, status, reason)
        values (_key_id, key_space, _batch_id, _body_digest, 'rejected', problem);
        return jsonb_build_object('status', 'rejected', 'reason', problem);
      end if;

      begin
        for r in select * from jsonb_array_elements(_runs) loop
          insert into workflow_runs (deployment_id, activity_space_id, external_id, template_version, subject_ref, subject_digest, started_at)
          values ((r->>'deployment_id')::uuid, key_space, r->>'external_id', (r->>'template_version')::integer,
                  r->>'subject_ref', r->>'subject_digest', (r->>'started_at')::timestamptz)
          on conflict (deployment_id, external_id) do nothing;
          if found then runs_added := runs_added + 1; end if;
        end loop;

        for s in select e from jsonb_array_elements(_steps) with ordinality t(e, i) order by i loop
          continue when exists (select 1 from workflow_run_steps
            where deployment_id = (s->>'deployment_id')::uuid and event_id = s->>'event_id');
          select id into the_run from workflow_runs
          where deployment_id = (s->>'deployment_id')::uuid and external_id = s->>'run_external_id';
          if the_run is null then
            raise exception 'event % names run % that was never sent', s->>'event_id', s->>'run_external_id';
          end if;
          insert into workflow_run_steps (run_id, deployment_id, activity_space_id, step_key, kind, connector, operation,
            result, actor_kind, actor_name, reason, occurred_at, duration_ms, seq, prev_hash, hash,
            event_id, gateway_digest, gateway_key_id, grants_version, outside_grant)
          values (the_run, (s->>'deployment_id')::uuid, key_space, s->>'step_key', s->>'kind', s->>'connector',
            s->>'operation', s->>'result', s->>'actor_kind', s->>'actor_name', s->>'reason',
            (s->>'occurred_at')::timestamptz, (s->>'duration_ms')::integer, 0, '', '',
            s->>'event_id', s->>'digest', _key_id, (s->>'grants_version')::integer,
            workflow_step_outside_grant((s->>'deployment_id')::uuid, s->>'connector', s->>'operation',
              (s->>'grants_version')::integer, (s->>'occurred_at')::timestamptz));
          steps_added := steps_added + 1;
        end loop;
      exception when others then
        -- A deadlock or serialization failure says nothing about the batch:
        -- let it fail, and the gateway sends the same batch again.
        if sqlstate like '40%' or sqlstate = '55P03' then
          raise;
        end if;
        -- Everything this block wrote is undone; only the rejection stays.
        problem := sqlerrm;
        insert into workflow_intake_batches (gateway_key_id, activity_space_id, batch_id, body_digest, status, reason)
        values (_key_id, key_space, _batch_id, _body_digest, 'rejected', problem);
        return jsonb_build_object('status', 'rejected', 'reason', problem);
      end;

      insert into workflow_intake_batches (gateway_key_id, activity_space_id, batch_id, body_digest, status, runs_added, steps_added)
      values (_key_id, key_space, _batch_id, _body_digest, 'accepted', runs_added, steps_added);
      return jsonb_build_object('status', 'accepted', 'runs_added', runs_added, 'steps_added', steps_added);
    end;
    $b$
  $fn$;
  execute 'revoke all on function public.workflow_intake(uuid, text, text, jsonb, jsonb) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.workflow_intake(uuid, text, text, jsonb, jsonb) to service_role';
  end if;

  -- ── the Audit app reads whether a step was outside its grants ──────────
  execute 'drop function if exists public.audit_ledger_runs(uuid, timestamptz, integer)';
  execute $fn$
    create function public.audit_ledger_runs(_space_id uuid, _since timestamptz, _limit integer default 5000)
    returns jsonb
    language plpgsql stable security definer set search_path = public as $b$
    declare
      cap constant integer := least(greatest(coalesce(_limit, 5000), 1), 5000);
      result jsonb;
    begin
      with visible as (
        select d.id from workflow_deployments d
        where d.activity_space_id = _space_id and public.user_can_see_deployment(d.id)
      ), recent as (
        select r.* from workflow_runs r join visible v on v.id = r.deployment_id
        where r.started_at >= _since
        order by r.started_at desc, r.id
        limit cap + 1
      ), open_older as (
        select r.* from workflow_runs r join visible v on v.id = r.deployment_id
        where r.started_at < _since
          and not exists (select 1 from workflow_run_steps s where s.run_id = r.id and s.kind = 'end')
      ), picked as (
        select * from (select * from recent order by started_at desc, id limit cap) kept
        union all select * from open_older
      )
      select jsonb_build_object(
        'runs', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'deployment_id', p.deployment_id, 'external_id', p.external_id,
            'template_version', p.template_version, 'subject_ref', p.subject_ref,
            'subject_digest', p.subject_digest, 'started_at', p.started_at,
            'steps', coalesce((
              select jsonb_agg(jsonb_build_object(
                'seq', s.seq, 'step_key', s.step_key, 'kind', s.kind, 'connector', s.connector,
                'operation', s.operation, 'result', s.result, 'reason', s.reason,
                'outside_grant', s.outside_grant) order by s.seq)
              from workflow_run_steps s where s.run_id = p.id
            ), '[]'::jsonb)
          ) order by p.started_at desc, p.id)
          from picked p
        ), '[]'::jsonb),
        'truncated', (select count(*) from recent) > cap,
        'readAt', statement_timestamp()
      ) into result;
      if octet_length(result::text) > 25000000 then
        raise exception using errcode = '54000', message = 'This Space exceeds the Audit response limit.';
      end if;
      return result;
    end;
    $b$
  $fn$;
  execute 'revoke all on function public.audit_ledger_runs(uuid, timestamptz, integer) from public, anon';
  execute 'grant execute on function public.audit_ledger_runs(uuid, timestamptz, integer) to authenticated';

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.deployment_grants, public.deployment_grant_versions from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.deployment_grants, public.deployment_grant_versions from authenticated';
    execute 'grant select, insert, delete on public.deployment_grants to authenticated';
    execute 'grant select on public.deployment_grant_versions to authenticated';
  end if;
  -- No function writes grants: the service role (every Edge Function,
  -- run-agent included) can read them and nothing more.
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke insert, update, delete, truncate on public.deployment_grants, public.deployment_grant_versions from service_role';
  end if;
end $$;
