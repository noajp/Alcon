-- Approvals a gateway asks a person for (ADR 0047): an operation the gateway
-- will carry out only with a person's yes, bound to the exact content it
-- will send, and good for one use.
--
--   workflow_approvals   one request per operation: which deployment and
--                        run, which connector and operation, the SHA-256 of
--                        the content (input_hash, never the content), a
--                        summary for the person, and until when it may be
--                        decided and used. Then who decided, and when the
--                        gateway used it
--   notifications        gains workflow_approval_id, so the request reaches
--                        the Space's owners in their Inbox
--
-- The gateway asks (workflow_approval_request) and later redeems
-- (workflow_approval_redeem) with the hash of what it is about to send: the
-- database spends the approval once, and only if the hash is the one that
-- was approved; audit-approvals then signs the proof. A person decides in the
-- Inbox (decide_workflow_approval). Nothing else writes the table.
-- Guarded for preview replay: the ledger and the intake may be absent.
do $$
begin
  if to_regclass('public.workflow_deployments') is null
     or to_regclass('public.workflow_gateway_keys') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.activity_space_members') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.workers') is null
     or to_regprocedure('public.user_can_see_deployment(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('public.is_delegated_request()') is null
     or to_regprocedure('public.workflow_records_append_only()') is null then
    raise notice 'workflow_approvals skipped: the audit ledger, its intake or notifications not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.workflow_approvals (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null,
      deployment_id uuid not null references public.workflow_deployments(id) on delete cascade,
      gateway_key_id uuid not null references public.workflow_gateway_keys(id) on delete cascade,
      request_id text not null check (request_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
      run_external_id text not null check (run_external_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
      connector text not null check (char_length(connector) between 1 and 200),
      operation text not null check (operation in ('read', 'draft', 'send', 'money')),
      input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
      summary text not null check (char_length(summary) between 1 and 2000),
      requested_at timestamptz not null default now(),
      expires_at timestamptz not null,
      status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
      decided_by uuid,
      decided_by_name text,
      decided_at timestamptz,
      decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
      consumed_at timestamptz,
      unique (deployment_id, request_id),
      check (expires_at > requested_at),
      check ((status = 'pending') = (decided_at is null)),
      check (consumed_at is null or status = 'approved')
    )
  $ddl$;
  execute 'create index if not exists workflow_approvals_pending_idx on public.workflow_approvals (activity_space_id, requested_at desc) where status = ''pending''';
  execute 'create index if not exists workflow_approvals_deployment_idx on public.workflow_approvals (deployment_id, requested_at desc)';
  execute 'alter table public.workflow_approvals enable row level security';
  execute 'drop policy if exists workflow_approvals_read on public.workflow_approvals';
  execute 'create policy workflow_approvals_read on public.workflow_approvals for select to authenticated using (public.user_can_see_deployment(deployment_id))';
  -- Kept for the audit: never deleted except with the Space.
  execute 'drop trigger if exists workflow_approvals_kept on public.workflow_approvals';
  execute 'create trigger workflow_approvals_kept before delete on public.workflow_approvals for each row execute function public.workflow_records_append_only()';
  execute 'drop trigger if exists workflow_approvals_no_truncate on public.workflow_approvals';
  execute 'create trigger workflow_approvals_no_truncate before truncate on public.workflow_approvals for each statement execute function public.workflow_records_append_only()';

  execute 'alter table public.notifications add column if not exists workflow_approval_id uuid references public.workflow_approvals(id) on delete cascade';

  -- ── the gateway asks ───────────────────────────────────────────────────
  -- Idempotent on (deployment, request_id): the same request again returns
  -- the one already held; the same id with different content is refused.
  -- A new request reaches every owner of the Space in their Inbox.
  execute 'drop function if exists public.workflow_approval_request(uuid, text, uuid, text, text, text, text, text, integer)';
  execute $fn$
    create function public.workflow_approval_request(_key_id uuid, _request_id text, _deployment_id uuid, _run_external_id text,
      _connector text, _operation text, _input_hash text, _summary text, _valid_minutes integer)
    returns jsonb
    language plpgsql security definer set search_path = public as $b$
    declare
      key_space uuid;
      dep workflow_deployments%rowtype;
      held workflow_approvals%rowtype;
      minutes integer := least(greatest(coalesce(_valid_minutes, 1440), 5), 1440);
    begin
      select activity_space_id into key_space from workflow_gateway_keys where id = _key_id and revoked_at is null;
      if key_space is null then
        return jsonb_build_object('status', 'refused', 'reason', 'unknown or revoked key', 'key_revoked', true);
      end if;
      select * into dep from workflow_deployments where id = _deployment_id and activity_space_id = key_space;
      if dep.id is null then
        return jsonb_build_object('status', 'refused', 'reason', 'deployment is not in this key''s Space');
      end if;

      perform pg_advisory_xact_lock(hashtextextended(_deployment_id::text || '/' || _request_id, 0));
      select * into held from workflow_approvals where deployment_id = _deployment_id and request_id = _request_id;
      if held.id is not null then
        if held.run_external_id <> _run_external_id or held.connector <> _connector or held.operation <> _operation
           or held.input_hash <> _input_hash or held.summary <> _summary then
          return jsonb_build_object('status', 'refused', 'reason', 'request id already used for a different request');
        end if;
        return jsonb_build_object('status', 'held', 'approval_id', held.id, 'expires_at', held.expires_at);
      end if;

      insert into workflow_approvals (activity_space_id, deployment_id, gateway_key_id, request_id, run_external_id,
        connector, operation, input_hash, summary, expires_at)
      values (key_space, _deployment_id, _key_id, _request_id, _run_external_id, _connector, _operation, _input_hash,
        _summary, now() + make_interval(mins => minutes))
      returning * into held;

      insert into notifications (recipient_id, actor_name, kind, title, body, workflow_approval_id)
      select m.user_id, dep.name, 'approval_requested', held.summary,
             dep.name || ' · ' || held.connector || ' · ' || held.operation, held.id
      from activity_space_members m
      where m.activity_space_id = key_space and m.role = 'owner';

      return jsonb_build_object('status', 'requested', 'approval_id', held.id, 'expires_at', held.expires_at);
    end;
    $b$
  $fn$;
  execute 'revoke all on function public.workflow_approval_request(uuid, text, uuid, text, text, text, text, text, integer) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.workflow_approval_request(uuid, text, uuid, text, text, text, text, text, integer) to service_role';
  end if;

  -- ── a person decides ───────────────────────────────────────────────────
  -- The Space's owner, signed in themselves: a delegated call (an outside
  -- agent acting for the person) never approves.
  execute 'drop function if exists public.decide_workflow_approval(uuid, boolean, text)';
  execute $fn$
    create function public.decide_workflow_approval(_approval_id uuid, _approve boolean, _note text default null)
    returns jsonb
    language plpgsql security definer set search_path = public as $b$
    declare
      held workflow_approvals%rowtype;
      who text;
    begin
      if auth.uid() is null or public.is_delegated_request() then
        raise exception 'approvals are decided only by a signed-in person';
      end if;
      select * into held from workflow_approvals where id = _approval_id for update;
      if held.id is null or not public.is_activity_space_owner(held.activity_space_id) then
        raise exception 'only the Space''s owner can decide this approval';
      end if;
      if held.status <> 'pending' then
        return jsonb_build_object('status', held.status, 'changed', false);
      end if;
      if held.expires_at <= now() then
        return jsonb_build_object('status', 'expired', 'changed', false);
      end if;
      -- The name the proof carries to the gateway: the person's Worker in
      -- this Space, else their display name — never their email address.
      select coalesce(
        (select nullif(btrim(w.name), '') from workers w
         where w.user_id = auth.uid() and (w.activity_space_id = held.activity_space_id or w.activity_space_id is null)
         order by (w.activity_space_id is null) limit 1),
        (select nullif(btrim(p.display_name), '') from profiles p where p.id = auth.uid()),
        'Space owner') into who;
      update workflow_approvals
      set status = case when _approve then 'approved' else 'rejected' end,
          decided_by = auth.uid(), decided_by_name = who, decided_at = now(),
          decision_note = nullif(btrim(left(coalesce(_note, ''), 2000)), '')
      where id = _approval_id;
      return jsonb_build_object('status', case when _approve then 'approved' else 'rejected' end, 'changed', true);
    end;
    $b$
  $fn$;
  execute 'revoke all on function public.decide_workflow_approval(uuid, boolean, text) from public, anon';
  execute 'grant execute on function public.decide_workflow_approval(uuid, boolean, text) to authenticated';

  -- ── the gateway uses it, once ──────────────────────────────────────────
  -- With the hash of what it is about to send. Spent only when approved,
  -- unexpired, unused and the hash matches; otherwise says why and spends
  -- nothing. A second redemption is refused even with the right hash. Only
  -- the key that asked may redeem: another gateway of the same Space cannot
  -- spend it.
  execute 'drop function if exists public.workflow_approval_redeem(uuid, uuid, text)';
  execute $fn$
    create function public.workflow_approval_redeem(_key_id uuid, _approval_id uuid, _input_hash text)
    returns jsonb
    language plpgsql security definer set search_path = public as $b$
    declare
      key_space uuid;
      held workflow_approvals%rowtype;
    begin
      select activity_space_id into key_space from workflow_gateway_keys where id = _key_id and revoked_at is null;
      if key_space is null then
        return jsonb_build_object('status', 'refused', 'reason', 'unknown or revoked key', 'key_revoked', true);
      end if;
      select * into held from workflow_approvals where id = _approval_id and gateway_key_id = _key_id for update;
      if held.id is null then return jsonb_build_object('status', 'refused', 'reason', 'no such approval'); end if;
      if held.status = 'rejected' then return jsonb_build_object('status', 'rejected', 'note', held.decision_note); end if;
      if held.consumed_at is not null then return jsonb_build_object('status', 'used', 'used_at', held.consumed_at); end if;
      if held.expires_at <= now() then return jsonb_build_object('status', 'expired'); end if;
      if held.status = 'pending' then return jsonb_build_object('status', 'pending', 'expires_at', held.expires_at); end if;
      if held.input_hash <> _input_hash then return jsonb_build_object('status', 'mismatch'); end if;
      update workflow_approvals set consumed_at = now() where id = _approval_id returning * into held;
      return jsonb_build_object(
        'status', 'redeemed', 'approval_id', held.id, 'space_id', held.activity_space_id,
        'deployment_id', held.deployment_id, 'run_external_id', held.run_external_id,
        'connector', held.connector, 'operation', held.operation, 'input_hash', held.input_hash,
        'approved_by', held.decided_by_name, 'approved_at', held.decided_at, 'used_at', held.consumed_at);
    end;
    $b$
  $fn$;
  execute 'revoke all on function public.workflow_approval_redeem(uuid, uuid, text) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.workflow_approval_redeem(uuid, uuid, text) to service_role';
  end if;

  -- Only these functions write: no role edits approvals by statement.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on public.workflow_approvals from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on public.workflow_approvals from authenticated';
    execute 'grant select on public.workflow_approvals to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke insert, update, delete, truncate on public.workflow_approvals from service_role';
  end if;
end $$;
