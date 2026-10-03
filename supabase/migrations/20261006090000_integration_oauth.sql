-- OAuth integrations (ADR 0035): a Space owner connects Google Drive with
-- Google sign-in through the integration-oauth Edge Function.
--
--   integrations.external_account   the account the tokens belong to (the
--                                   Google email). Members read it; only the
--                                   service role writes it.
--   integration_oauth_states        one row per sign-in in progress: hashes
--                                   of the one-time ticket, the state, the
--                                   browser nonce and the completion handle,
--                                   plus the PKCE verifier. No browser role
--                                   can read or write it.
--   stash_integration_oauth_pending service role only: after Google answers,
--                                   holds the token set in Vault
--                                   (`integration-oauth-pending:<flow id>`)
--                                   until the person who started the sign-in
--                                   confirms it.
--   take_integration_oauth_pending  service role only: hands over that token
--                                   set once, by the completion handle's
--                                   hash, and deletes the flow.
--   store_integration_oauth_token   service role only: writes the Vault
--                                   secret `integration:<id>` of an OAuth
--                                   integration — a refresh only while the
--                                   stored refresh token is still the one it
--                                   started from — or, with an empty value,
--                                   clears it.
--   set_integration_secret          refuses to write an OAuth integration's
--                                   credential (clearing it is still allowed),
--                                   so tokens come only from the sign-in.
--   integrations_rebind_drops_secret also clears external_account.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.integrations') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault')
     or to_regclass('auth.users') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('extensions.digest(text,text)') is null then
    raise notice 'integration oauth skipped: integrations, vault, auth.users, is_activity_space_owner or pgcrypto not present';
    return;
  end if;

  execute 'alter table public.integrations add column if not exists external_account text';
  -- Browser roles write integrations through column grants that do not name
  -- external_account. anon has no policy on the table; its table-wide write
  -- grants are dropped so the new column is not writable by any browser role.
  execute 'revoke insert, update on public.integrations from anon';

  execute $ddl$
    create table if not exists public.integration_oauth_states (
      id uuid primary key default gen_random_uuid(),
      integration_id uuid not null references public.integrations(id) on delete cascade,
      user_id uuid not null references auth.users(id) on delete cascade,
      ticket_hash text unique check (ticket_hash ~ '^[0-9a-f]{64}$'),
      state_hash text unique check (state_hash ~ '^[0-9a-f]{64}$'),
      browser_nonce_hash text check (browser_nonce_hash ~ '^[0-9a-f]{64}$'),
      code_verifier text not null check (char_length(code_verifier) between 43 and 128),
      ticket_expires_at timestamptz not null default now() + interval '2 minutes',
      expires_at timestamptz not null default now() + interval '10 minutes',
      completion_hash text unique check (completion_hash ~ '^[0-9a-f]{64}$'),
      completion_expires_at timestamptz,
      pending_account text,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists integration_oauth_states_expires_idx on public.integration_oauth_states (expires_at)';
  execute 'alter table public.integration_oauth_states enable row level security';
  execute 'revoke all on table public.integration_oauth_states from public, anon, authenticated';

  -- A flow's held token set goes with the flow, however the row is deleted
  -- (taken, expired, or with its integration).
  execute $ddl$
    create or replace function public.integration_oauth_states_drop_pending()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    begin
      delete from vault.secrets where name = 'integration-oauth-pending:' || old.id::text;
      return old;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.integration_oauth_states_drop_pending() from public, anon, authenticated';
  execute 'drop trigger if exists trg_integration_oauth_states_drop_pending on public.integration_oauth_states';
  execute 'create trigger trg_integration_oauth_states_drop_pending after delete on public.integration_oauth_states
             for each row execute function public.integration_oauth_states_drop_pending()';

  execute $ddl$
    create or replace function public.stash_integration_oauth_pending(p_flow_id uuid, p_secret text, p_account text, p_completion_hash text)
    returns void
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_name text := 'integration-oauth-pending:' || p_flow_id::text;
      v_secret_id uuid;
    begin
      if p_secret is null or length(p_secret) = 0 then
        raise exception 'token set required' using errcode = '22023';
      end if;
      if p_completion_hash is null or p_completion_hash !~ '^[0-9a-f]{64}$' then
        raise exception 'completion hash required' using errcode = '22023';
      end if;
      perform 1 from public.integration_oauth_states where id = p_flow_id for update;
      if not found then
        raise exception 'sign-in not found' using errcode = 'P0002';
      end if;
      select id into v_secret_id from vault.secrets where name = v_name;
      if v_secret_id is null then
        perform vault.create_secret(p_secret, v_name, 'Alcon integration sign-in awaiting confirmation');
      else
        perform vault.update_secret(v_secret_id, p_secret);
      end if;
      update public.integration_oauth_states
         set completion_hash = p_completion_hash,
             completion_expires_at = now() + interval '10 minutes',
             pending_account = p_account,
             ticket_hash = null,
             state_hash = null
       where id = p_flow_id;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.stash_integration_oauth_pending(uuid, text, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.stash_integration_oauth_pending(uuid, text, text, text) to service_role';

  execute $ddl$
    create or replace function public.take_integration_oauth_pending(p_completion_hash text)
    returns table (flow_integration_id uuid, flow_user_id uuid, token_set text, account text, flow_expires_at timestamptz)
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_flow public.integration_oauth_states%rowtype;
      v_secret text;
    begin
      select * into v_flow from public.integration_oauth_states s
       where s.completion_hash = p_completion_hash
       for update;
      if not found then return; end if;
      select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds
       where ds.name = 'integration-oauth-pending:' || v_flow.id::text;
      -- Single use: the flow and its held token set are gone after this call.
      delete from public.integration_oauth_states where id = v_flow.id;
      return query select v_flow.integration_id, v_flow.user_id, v_secret, v_flow.pending_account, v_flow.completion_expires_at;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.take_integration_oauth_pending(text) from public, anon, authenticated';
  execute 'grant execute on function public.take_integration_oauth_pending(text) to service_role';

  execute 'drop function if exists public.store_integration_oauth_token(uuid, text)';
  execute $ddl$
    create or replace function public.store_integration_oauth_token(p_integration_id uuid, p_secret text, p_expected_refresh_hash text default null)
    returns boolean
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_auth text;
      v_secret_id uuid;
      v_current text;
      v_current_hash text;
      v_name text := 'integration:' || p_integration_id::text;
    begin
      select auth_type into v_auth from public.integrations where id = p_integration_id for update;
      if v_auth is null then
        raise exception 'integration not found' using errcode = 'P0002';
      end if;
      if v_auth <> 'oauth' then
        raise exception 'not an OAuth integration' using errcode = '22023';
      end if;
      select id into v_secret_id from vault.secrets where name = v_name;
      if p_secret is null or length(p_secret) = 0 then
        if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
        update public.integrations set secret_id = null, external_account = null, updated_at = now() where id = p_integration_id;
        return true;
      end if;
      -- A refresh writes only over the token set it refreshed: a reconnect or
      -- a revoke since then wins.
      if p_expected_refresh_hash is not null then
        select ds.decrypted_secret into v_current from vault.decrypted_secrets ds where ds.name = v_name;
        begin
          v_current_hash := encode(extensions.digest(v_current::jsonb ->> 'refresh_token', 'sha256'), 'hex');
        exception when others then
          v_current_hash := null;
        end;
        if v_current_hash is null or v_current_hash <> p_expected_refresh_hash then
          return false;
        end if;
      end if;
      if v_secret_id is null then
        v_secret_id := vault.create_secret(p_secret, v_name, 'Alcon integration credential');
      else
        perform vault.update_secret(v_secret_id, p_secret);
      end if;
      update public.integrations set secret_id = v_secret_id, updated_at = now() where id = p_integration_id;
      return true;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.store_integration_oauth_token(uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.store_integration_oauth_token(uuid, text, text) to service_role';

  execute $ddl$
    create or replace function public.set_integration_secret(p_integration_id uuid, p_secret text)
    returns void
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_space uuid;
      v_auth text;
      v_secret_id uuid;
      v_name text := 'integration:' || p_integration_id::text;
    begin
      select activity_space_id, auth_type into v_space, v_auth from public.integrations where id = p_integration_id;
      if v_space is null or not public.is_activity_space_owner(v_space) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      -- Anywhere in the value: "Bearer alc_pat_…" for a header credential,
      -- leading whitespace, or a token inside a JSON blob are all refused.
      if p_secret is not null and position('alc_pat_' in p_secret) > 0 then
        raise exception 'An Alcon personal access token cannot be used as an integration credential.' using errcode = '22023';
      end if;
      -- An OAuth credential comes only from the sign-in (integration-oauth).
      if v_auth = 'oauth' and p_secret is not null and length(p_secret) > 0 then
        raise exception 'This connection signs in with OAuth; its credential cannot be entered.' using errcode = '22023';
      end if;
      -- The secret is found by its name, never by a secret_id a row claims.
      select id into v_secret_id from vault.secrets where name = v_name;
      if p_secret is null or length(p_secret) = 0 then
        if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
        update public.integrations set secret_id = null, external_account = null, updated_at = now() where id = p_integration_id;
        return;
      end if;
      if v_secret_id is null then
        v_secret_id := vault.create_secret(p_secret, v_name, 'Alcon integration credential');
      else
        perform vault.update_secret(v_secret_id, p_secret);
      end if;
      update public.integrations set secret_id = v_secret_id, updated_at = now() where id = p_integration_id;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.set_integration_secret(uuid, text) from public, anon';
  execute 'grant execute on function public.set_integration_secret(uuid, text) to authenticated';

  execute $ddl$
    create or replace function public.integrations_rebind_drops_secret()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    begin
      if new.endpoint is distinct from old.endpoint
         or new.auth_type is distinct from old.auth_type
         or new.auth_header is distinct from old.auth_header then
        delete from vault.secrets where name = 'integration:' || old.id::text;
        new.secret_id := null;
        new.last_test := null;
        new.external_account := null;
      end if;
      return new;
    end
    $f$
  $ddl$;
  execute 'drop trigger if exists trg_integrations_rebind_drops_secret on public.integrations';
  execute 'create trigger trg_integrations_rebind_drops_secret before update on public.integrations
             for each row execute function public.integrations_rebind_drops_secret()';
end
$$;
