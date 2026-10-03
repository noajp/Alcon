-- OAuth integrations (ADR 0034): a Space owner connects Google Drive with
-- Google sign-in, and the integration-oauth Edge Function stores the tokens.
--
--   integrations.external_account   the account the tokens belong to (the
--                                   Google email). Members read it; only the
--                                   service role writes it.
--   integration_oauth_states        one row per sign-in in progress: hashes
--                                   of the one-time ticket, the state and the
--                                   browser nonce, plus the PKCE verifier.
--                                   No browser role can read or write it.
--   store_integration_oauth_token   service role only: writes (or, with an
--                                   empty value, clears) the Vault secret
--                                   `integration:<id>` of an OAuth
--                                   integration.
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
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'integration oauth skipped: integrations, vault, auth.users or is_activity_space_owner not present';
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
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists integration_oauth_states_expires_idx on public.integration_oauth_states (expires_at)';
  execute 'alter table public.integration_oauth_states enable row level security';
  execute 'revoke all on table public.integration_oauth_states from public, anon, authenticated';

  execute $ddl$
    create or replace function public.store_integration_oauth_token(p_integration_id uuid, p_secret text)
    returns void
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_auth text;
      v_secret_id uuid;
      v_name text := 'integration:' || p_integration_id::text;
    begin
      select auth_type into v_auth from public.integrations where id = p_integration_id;
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
  execute 'revoke all on function public.store_integration_oauth_token(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.store_integration_oauth_token(uuid, text) to service_role';

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
