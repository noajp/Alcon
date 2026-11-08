-- Credential capture (secure-login PR2): the use-once stash and the
-- decision RPCs the capture dialog answers through.
--
-- PR1 landed the record (credential_requests) and the site-class save
-- addressed by request id. This migration lands the rest of the front
-- door's database contract:
--
--   credential_once_stash   metadata for a use-once value (never the
--                           value): the value itself lives in Vault
--                           as `credential-once:<request id>`, the
--                           OAuth pending pattern generalized
--                           (20261006090000). Single-take, 10-minute
--                           TTL (decision D7).
--   stash_credential_once   the dialog's use-once submit. Owner-only
--                           (D1 — the person who may decide the
--                           request is a Space owner), addressed by
--                           request id, so the value is filed under
--                           the need the dialog displayed and no
--                           other. The request moves to used_once.
--   take_credential_once    service role only: hands the value to
--                           the one server path executing the pending
--                           need and deletes the Vault secret and
--                           the stash in the same call — taken once,
--                           or never.
--   decline_credential_request
--                           the dialog's Cancel: a decline is an
--                           answer, not a timeout. Owner or the
--                           person who raised the need; the decline
--                           lands on the audit where a credential
--                           referent exists.
--   complete_credential_request
--                           seals a token-class save: the browser
--                           wrote through set_integration_secret
--                           directly (no new write path for the
--                           value), then this RPC verifies the slot
--                           is actually filled before it marks the
--                           request saved and writes the audit row —
--                           a request cannot be talked into 'saved'.
--   expire_credential_requests
--                           service role only, called by the
--                           automations tick: pending requests past
--                           their expiry lapse to expired, and a
--                           stash nobody took in its TTL is deleted
--                           with its request — an untaken one-time
--                           secret never lingers as a standing one.
--
-- A deleted request takes its once-secret with it (trigger, the
-- OAuth pending idiom). No value is ever returned to a browser role:
-- stash returns a status word, take is service-role only.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.credential_requests') is null
     or to_regclass('public.credential_uses') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault')
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'credential capture skipped: credential_requests, credential_uses, vault or is_activity_space_owner not present';
    return;
  end if;

  -- ── The stash: metadata only, the value lives in Vault ─────────────
  execute $ddl$
    create table if not exists public.credential_once_stash (
      request_id uuid primary key references public.credential_requests(id) on delete cascade,
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists credential_once_stash_expiry_idx on public.credential_once_stash (expires_at)';
  execute 'alter table public.credential_once_stash enable row level security';
  -- No browser role touches the stash at all: the definer RPCs below
  -- are its only doors.
  execute 'revoke all on table public.credential_once_stash from public, anon, authenticated';

  -- ── A deleted request takes its once-secret with it ────────────────
  execute $ddl$
    create or replace function public.credential_requests_drop_once_secret()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    begin
      delete from vault.secrets where name = 'credential-once:' || old.id::text;
      return old;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.credential_requests_drop_once_secret() from public, anon, authenticated';
  execute 'drop trigger if exists trg_credential_requests_drop_once_secret on public.credential_requests';
  execute 'create trigger trg_credential_requests_drop_once_secret after delete on public.credential_requests
             for each row execute function public.credential_requests_drop_once_secret()';

  -- ── Use once: the dialog's unchecked-checkbox submit ───────────────
  execute $ddl$
    create or replace function public.stash_credential_once(
      p_request_id uuid,
      p_username text,
      p_value text
    )
    returns text
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_req public.credential_requests%rowtype;
      v_username text;
      v_stored text;
      v_name text := 'credential-once:' || p_request_id::text;
      v_secret_id uuid;
    begin
      select * into v_req from public.credential_requests where id = p_request_id for update;
      if not found then
        raise exception 'credential request not found' using errcode = 'P0002';
      end if;
      if v_req.status <> 'pending' then
        raise exception 'this credential request is no longer pending' using errcode = '22023';
      end if;
      -- Saving a credential is the owner's act (D1), whichever class:
      -- the stash spends into every run in the Space, so its
      -- governance matches its blast radius.
      if not public.is_activity_space_owner(v_req.activity_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if p_value is null or length(p_value) = 0 then
        raise exception 'enter the credential to use it once' using errcode = '22023';
      end if;
      -- An Alcon token is never a credential (the set_integration_secret
      -- refusal, mirrored): not even a one-time one.
      if position('alc_pat_' in p_value) > 0 then
        raise exception 'An Alcon personal access token cannot be used as a credential.' using errcode = '22023';
      end if;

      if v_req.kind = 'site_login' then
        -- The pair travels as one value, the site-credential shape.
        v_username := nullif(btrim(coalesce(p_username, '')), '');
        if v_username is null then
          v_username := nullif(btrim(coalesce(v_req.username_hint, '')), '');
        end if;
        if v_username is null then
          raise exception 'Enter the username for this site login.' using errcode = '22023';
        end if;
        v_stored := jsonb_build_object('username', v_username, 'password', p_value)::text;
      else
        v_stored := p_value;
      end if;

      select id into v_secret_id from vault.secrets where name = v_name;
      if v_secret_id is null then
        perform vault.create_secret(v_stored, v_name, 'Alcon one-time credential awaiting its one use');
      else
        perform vault.update_secret(v_secret_id, v_stored);
      end if;
      insert into public.credential_once_stash (request_id, activity_space_id, expires_at)
      values (p_request_id, v_req.activity_space_id, now() + interval '10 minutes')
      on conflict (request_id) do update set expires_at = excluded.expires_at, created_at = now();
      update public.credential_requests
         set status = 'used_once', decided_by = auth.uid(), decided_at = now()
       where id = p_request_id;
      return 'stashed';
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.stash_credential_once(uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.stash_credential_once(uuid, text, text) to authenticated';

  -- ── The take: one server path, one use, then gone ──────────────────
  execute $ddl$
    create or replace function public.take_credential_once(p_request_id uuid)
    returns table (username text, value text)
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_req public.credential_requests%rowtype;
      v_stash public.credential_once_stash%rowtype;
      v_secret text;
      v_pair jsonb;
    begin
      select * into v_stash from public.credential_once_stash where request_id = p_request_id for update;
      if not found then return; end if;
      select * into v_req from public.credential_requests where id = p_request_id;
      select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds
       where ds.name = 'credential-once:' || p_request_id::text;
      -- Single take, expired or not: the secret and the stash die in
      -- this call, so a value can never be taken twice or linger.
      delete from vault.secrets where name = 'credential-once:' || p_request_id::text;
      delete from public.credential_once_stash where request_id = p_request_id;
      if v_stash.expires_at < now() or v_secret is null then
        if v_req.status = 'used_once' then
          update public.credential_requests set status = 'expired' where id = p_request_id;
        end if;
        return;
      end if;
      insert into public.credential_uses (activity_space_id, credential_kind, event, origin, detail)
      values (v_req.activity_space_id, 'once', 'used', v_req.origin, 'one-time credential for request ' || p_request_id::text);
      if v_req.kind = 'site_login' then
        v_pair := v_secret::jsonb;
        username := v_pair ->> 'username';
        value := v_pair ->> 'password';
      else
        username := null;
        value := v_secret;
      end if;
      return next;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.take_credential_once(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.take_credential_once(uuid) to service_role';

  -- ── Decline: the dialog's Cancel is an answer ──────────────────────
  execute $ddl$
    create or replace function public.decline_credential_request(p_request_id uuid)
    returns text
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_req public.credential_requests%rowtype;
    begin
      select * into v_req from public.credential_requests where id = p_request_id for update;
      if not found then
        raise exception 'credential request not found' using errcode = 'P0002';
      end if;
      -- The decider is an owner (D1); the person who raised the need
      -- may also withdraw it. Anyone else is not the ask's audience.
      if not public.is_activity_space_owner(v_req.activity_space_id)
         and v_req.requested_by is distinct from auth.uid() then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if v_req.status <> 'pending' then
        return v_req.status;
      end if;
      update public.credential_requests
         set status = 'declined', decided_by = auth.uid(), decided_at = now()
       where id = p_request_id;
      -- The audit row needs its referent: a token request always has
      -- its connection; a site request has its row only when the need
      -- was a re-auth. Without one the request row itself is the
      -- record (decided_by / decided_at above).
      if v_req.kind = 'integration_secret' and v_req.integration_id is not null then
        insert into public.credential_uses (activity_space_id, credential_kind, integration_id, event, actor_id)
        values (v_req.activity_space_id, 'integration', v_req.integration_id, 'declined', auth.uid());
      elsif v_req.kind = 'site_login' and v_req.site_credential_id is not null then
        insert into public.credential_uses (activity_space_id, credential_kind, site_credential_id, event, actor_id, origin)
        values (v_req.activity_space_id, 'site', v_req.site_credential_id, 'declined', auth.uid(), v_req.origin);
      end if;
      return 'declined';
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.decline_credential_request(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.decline_credential_request(uuid) to authenticated';

  -- ── Seal a token-class save the browser made directly ──────────────
  execute $ddl$
    create or replace function public.complete_credential_request(p_request_id uuid)
    returns text
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_req public.credential_requests%rowtype;
      v_secret_id uuid;
    begin
      select * into v_req from public.credential_requests where id = p_request_id for update;
      if not found then
        raise exception 'credential request not found' using errcode = 'P0002';
      end if;
      if not public.is_activity_space_owner(v_req.activity_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if v_req.status <> 'pending' then
        return v_req.status;
      end if;
      if v_req.kind = 'site_login' then
        -- The site save (set_site_credential) seals its own request;
        -- a site request still pending here was never saved.
        return 'not_saved';
      end if;
      -- Verify, don't trust: the request seals only when the slot the
      -- dialog named is actually filled.
      select secret_id into v_secret_id from public.integrations where id = v_req.integration_id;
      if v_secret_id is null then
        return 'not_saved';
      end if;
      update public.credential_requests
         set status = 'saved', decided_by = auth.uid(), decided_at = now()
       where id = p_request_id;
      insert into public.credential_uses (activity_space_id, credential_kind, integration_id, event, actor_id)
      values (v_req.activity_space_id, 'integration', v_req.integration_id,
              case when v_req.need ->> 'source' = 'reauth' then 'replaced' else 'stored' end,
              auth.uid());
      return 'saved';
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.complete_credential_request(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.complete_credential_request(uuid) to authenticated';

  -- ── The lapse: the tick's sweep ────────────────────────────────────
  execute $ddl$
    create or replace function public.expire_credential_requests()
    returns table (requests_expired integer, stashes_expired integer)
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_requests integer := 0;
      v_stashes integer := 0;
      v_row record;
    begin
      update public.credential_requests
         set status = 'expired'
       where status = 'pending'
         and expires_at is not null
         and expires_at < now();
      get diagnostics v_requests = row_count;
      -- An untaken one-time value dies with its request: the secret,
      -- the stash and the standing it briefly held, all of it.
      for v_row in
        select s.request_id from public.credential_once_stash s
         where s.expires_at < now()
      loop
        delete from vault.secrets where name = 'credential-once:' || v_row.request_id::text;
        delete from public.credential_once_stash where request_id = v_row.request_id;
        update public.credential_requests
           set status = 'expired'
         where id = v_row.request_id and status = 'used_once';
        v_stashes := v_stashes + 1;
      end loop;
      requests_expired := v_requests;
      stashes_expired := v_stashes;
      return next;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.expire_credential_requests() from public, anon, authenticated';
  execute 'grant execute on function public.expire_credential_requests() to service_role';
end
$$;
