-- The intake for the AI audit ledger (ADR 0045): where a gateway's signed
-- batches of records enter workflow_runs / workflow_run_steps.
--
--   workflow_gateway_keys    a gateway's Ed25519 public key, registered by the
--                            Space's owner. A key writes only to deployments
--                            in its Space; a revoked key writes nothing
--   workflow_intake_batches  every batch that arrived with a valid signature:
--                            accepted (and what it added) or rejected (and why)
--   workflow_run_steps       gains the gateway's own link: event_id (the
--                            gateway's id for the event, unique per
--                            deployment), gateway_digest (its hash of the
--                            event and the one before it) and the key it came
--                            with
--
-- The audit-intake function checks the signature and each event's digest;
-- workflow_intake, here, decides the rest in one transaction: the batch is
-- new or an exact repeat, every deployment is in the key's Space, and each
-- deployment's events continue from the last one stored. Nothing is written
-- unless the whole batch is.
-- Guarded for preview replay: the ledger itself may be absent.
do $$
begin
  if to_regclass('public.workflow_deployments') is null
     or to_regclass('public.workflow_runs') is null
     or to_regclass('public.workflow_run_steps') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'workflow_intake skipped: the audit ledger or its access functions not present';
    return;
  end if;

  -- ── keys ───────────────────────────────────────────────────────────────
  -- public_key is the raw 32-byte key, base64url without padding (43 chars).
  execute $ddl$
    create table if not exists public.workflow_gateway_keys (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      name text not null,
      public_key text not null unique check (public_key ~ '^[A-Za-z0-9_-]{43}$'),
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      revoked_at timestamptz
    )
  $ddl$;
  execute 'create index if not exists workflow_gateway_keys_space_idx on public.workflow_gateway_keys (activity_space_id)';
  execute 'alter table public.workflow_gateway_keys enable row level security';
  execute 'drop policy if exists workflow_gateway_keys_owner_read on public.workflow_gateway_keys';
  execute 'create policy workflow_gateway_keys_owner_read on public.workflow_gateway_keys for select to authenticated using (public.is_activity_space_owner(activity_space_id))';
  execute 'drop policy if exists workflow_gateway_keys_owner_insert on public.workflow_gateway_keys';
  execute 'create policy workflow_gateway_keys_owner_insert on public.workflow_gateway_keys for insert to authenticated with check (public.is_activity_space_owner(activity_space_id))';
  execute 'drop policy if exists workflow_gateway_keys_owner_update on public.workflow_gateway_keys';
  execute 'create policy workflow_gateway_keys_owner_update on public.workflow_gateway_keys for update to authenticated using (public.is_activity_space_owner(activity_space_id)) with check (public.is_activity_space_owner(activity_space_id))';

  -- A key is never edited and never deleted (the steps it wrote point at
  -- it): the one change is revoking it, and a revoked key stays revoked.
  -- A new key is a new row.
  execute $fn$
    create or replace function public.workflow_gateway_key_guard()
    returns trigger language plpgsql as $b$
    begin
      if tg_op = 'DELETE' then
        if pg_trigger_depth() > 1 then return old; end if;
        raise exception 'workflow gateway keys are revoked, not deleted';
      end if;
      if new.activity_space_id <> old.activity_space_id or new.name <> old.name
         or new.public_key <> old.public_key or new.created_by is distinct from old.created_by
         or new.created_at <> old.created_at then
        raise exception 'workflow gateway key: only revoking is allowed';
      end if;
      if old.revoked_at is not null then
        new.revoked_at := old.revoked_at;
      elsif new.revoked_at is not null then
        new.revoked_at := now();
      end if;
      return new;
    end;
    $b$
  $fn$;
  execute 'drop trigger if exists workflow_gateway_key_guard on public.workflow_gateway_keys';
  execute 'create trigger workflow_gateway_key_guard before update or delete on public.workflow_gateway_keys for each row execute function public.workflow_gateway_key_guard()';

  -- ── the gateway's link on each step ─────────────────────────────────────
  execute 'alter table public.workflow_run_steps add column if not exists event_id text';
  execute 'alter table public.workflow_run_steps add column if not exists gateway_digest text';
  execute 'alter table public.workflow_run_steps add column if not exists gateway_key_id uuid references public.workflow_gateway_keys(id)';
  execute 'create unique index if not exists workflow_run_steps_event_idx on public.workflow_run_steps (deployment_id, event_id) where event_id is not null';

  -- ── batches ────────────────────────────────────────────────────────────
  -- One accepted row per (key, batch_id); rejections are kept as they come,
  -- so a gateway may fix a batch and send it again under the same id.
  execute $ddl$
    create table if not exists public.workflow_intake_batches (
      id uuid primary key default gen_random_uuid(),
      gateway_key_id uuid not null references public.workflow_gateway_keys(id),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      batch_id text not null,
      body_digest text not null,
      status text not null check (status in ('accepted', 'rejected')),
      reason text,
      runs_added integer not null default 0,
      steps_added integer not null default 0,
      received_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create unique index if not exists workflow_intake_batches_accepted_idx on public.workflow_intake_batches (gateway_key_id, batch_id) where status = ''accepted''';
  execute 'create index if not exists workflow_intake_batches_space_idx on public.workflow_intake_batches (activity_space_id, received_at desc)';
  execute 'alter table public.workflow_intake_batches enable row level security';
  execute 'drop policy if exists workflow_intake_batches_owner_read on public.workflow_intake_batches';
  execute 'create policy workflow_intake_batches_owner_read on public.workflow_intake_batches for select to authenticated using (public.is_activity_space_owner(activity_space_id))';
  execute 'drop trigger if exists workflow_intake_batches_append_only on public.workflow_intake_batches';
  execute 'create trigger workflow_intake_batches_append_only before update or delete on public.workflow_intake_batches for each row execute function public.workflow_records_append_only()';

  -- ── intake ─────────────────────────────────────────────────────────────
  -- _runs:  [{deployment_id, external_id, template_version, subject_ref,
  --          subject_digest, started_at}]
  -- _steps: [{deployment_id, event_id, run_external_id, step_key, kind,
  --          connector, operation, result, actor_kind, actor_name, reason,
  --          occurred_at, duration_ms, prev_digest, digest}] in chain order
  -- Returns {status: accepted | duplicate | rejected, reason?, runs_added,
  -- steps_added}. A rejection writes no records, only its own row.
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
        return jsonb_build_object('status', 'rejected', 'reason', 'unknown or revoked key');
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
      -- Locking the deployments here holds the tails still until we write.
      if problem is null then
        for dep in
          select distinct (e->>'deployment_id')::uuid from jsonb_array_elements(_steps) e order by 1
        loop
          perform 1 from workflow_deployments where id = dep for update;
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
            event_id, gateway_digest, gateway_key_id)
          values (the_run, (s->>'deployment_id')::uuid, key_space, s->>'step_key', s->>'kind', s->>'connector',
            s->>'operation', s->>'result', s->>'actor_kind', s->>'actor_name', s->>'reason',
            (s->>'occurred_at')::timestamptz, (s->>'duration_ms')::integer, 0, '', '',
            s->>'event_id', s->>'digest', _key_id);
          steps_added := steps_added + 1;
        end loop;
      exception when others then
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

  -- A signed batch the function turned away before the intake (unreadable,
  -- malformed, or an event whose digest does not match): kept beside the
  -- intake's own rejections. A revoked key leaves nothing.
  execute 'drop function if exists public.workflow_intake_reject(uuid, text, text, text)';
  execute $fn$
    create function public.workflow_intake_reject(_key_id uuid, _batch_id text, _body_digest text, _reason text)
    returns void
    language sql security definer set search_path = public as $b$
      insert into workflow_intake_batches (gateway_key_id, activity_space_id, batch_id, body_digest, status, reason)
      select k.id, k.activity_space_id, left(_batch_id, 200), _body_digest, 'rejected', left(_reason, 2000)
      from workflow_gateway_keys k where k.id = _key_id and k.revoked_at is null;
    $b$
  $fn$;
  execute 'revoke all on function public.workflow_intake_reject(uuid, text, text, text) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.workflow_intake_reject(uuid, text, text, text) to service_role';
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.workflow_gateway_keys, public.workflow_intake_batches from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.workflow_gateway_keys, public.workflow_intake_batches from authenticated';
    execute 'grant select, insert, update (revoked_at) on public.workflow_gateway_keys to authenticated';
    execute 'grant select on public.workflow_intake_batches to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke update, delete, truncate on public.workflow_intake_batches from service_role';
    execute 'revoke delete, truncate on public.workflow_gateway_keys from service_role';
  end if;
end $$;
