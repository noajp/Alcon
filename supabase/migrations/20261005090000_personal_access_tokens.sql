-- Personal access tokens (ELE_PLT-005, ADR 0032).
--
-- External AI clients and scripts reach Alcon as the person who issued the
-- token. The token never authorises anything by itself: alcon-mcp resolves it
-- here (service role, this lookup only) and mints a five-minute user JWT, so
-- every read and write still runs under the person's RLS.
--
--   personal_access_tokens          one row per token. The plaintext is shown
--                                   once by create_personal_access_token and
--                                   never stored: token_hash is its SHA-256
--                                   hex. The owner reads their own rows,
--                                   every column except token_hash; nobody
--                                   writes the table directly.
--   is_delegated_request()          true when the caller's JWT was minted for
--                                   a delegated client (alcon_via) or issued
--                                   to an OAuth client (client_id). A
--                                   delegated caller may not issue or revoke
--                                   tokens.
--   create_personal_access_token    issue: name 1..60, 30 / 90 days or no
--                                   expiry, read or read_write, at most 20
--                                   active tokens per person.
--   revoke_personal_access_token    the owner revokes one of their own.
--   resolve_personal_access_token   service role only: hash → user_id, id,
--                                   name, access; refuses revoked, expired,
--                                   banned, deleted and anonymous users and
--                                   records last use at most once a minute.
--   set_integration_secret          also refuses an Alcon token, so an agent
--                                   cannot be handed one as a credential.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('auth.users') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise notice 'personal access tokens skipped: auth.users or pgcrypto not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.personal_access_tokens (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
      name text not null check (char_length(btrim(name)) between 1 and 60),
      token_prefix text not null,
      token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
      access text not null default 'read_write' check (access in ('read', 'read_write')),
      expires_at timestamptz,
      last_used_at timestamptz,
      last_used_client text,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists personal_access_tokens_user_idx on public.personal_access_tokens (user_id, created_at desc)';
  execute 'alter table public.personal_access_tokens enable row level security';

  -- Nobody writes the table directly; the owner reads every column but the hash.
  execute 'revoke all on table public.personal_access_tokens from public, anon, authenticated';
  execute 'grant select (id, user_id, name, token_prefix, access, expires_at, last_used_at, last_used_client, revoked_at, created_at)
             on public.personal_access_tokens to authenticated';

  execute $ddl$
    create or replace function public.is_delegated_request()
    returns boolean
    language sql stable
    set search_path = ''
    as $f$
      select coalesce((auth.jwt() ? 'alcon_via') or (auth.jwt() ? 'client_id'), false)
    $f$
  $ddl$;
  execute 'revoke all on function public.is_delegated_request() from public';
  execute 'grant execute on function public.is_delegated_request() to anon, authenticated, service_role';

  execute 'drop policy if exists personal_access_tokens_select_own on public.personal_access_tokens';
  execute $ddl$
    create policy personal_access_tokens_select_own on public.personal_access_tokens
      for select to authenticated
      using (user_id = (select auth.uid()) and not (select public.is_delegated_request()))
  $ddl$;

  execute $ddl$
    create or replace function public.create_personal_access_token(
      p_name text,
      p_expires_days integer default 90,
      p_access text default 'read_write'
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      v_uid uuid := auth.uid();
      v_name text := btrim(coalesce(p_name, ''));
      v_access text := coalesce(p_access, 'read_write');
      v_token text;
      v_id uuid;
    begin
      if v_uid is null then
        raise exception 'not signed in' using errcode = '42501';
      end if;
      if public.is_delegated_request() then
        raise exception 'personal access tokens can only be issued from the Alcon app' using errcode = '42501';
      end if;
      if exists (select 1 from auth.users u where u.id = v_uid and coalesce(u.is_anonymous, false)) then
        raise exception 'sign in with an account to issue tokens' using errcode = '42501';
      end if;
      if char_length(v_name) not between 1 and 60 then
        raise exception 'token name must be 1 to 60 characters' using errcode = '22023';
      end if;
      if p_expires_days is not null and p_expires_days not in (30, 90) then
        raise exception 'expiry must be 30 days, 90 days or none' using errcode = '22023';
      end if;
      if v_access not in ('read', 'read_write') then
        raise exception 'access must be read or read_write' using errcode = '22023';
      end if;

      -- Serialise one person's issues so the cap holds under concurrency.
      perform pg_advisory_xact_lock(hashtextextended('personal_access_tokens:' || v_uid::text, 0));
      if (select count(*) from public.personal_access_tokens t
          where t.user_id = v_uid and t.revoked_at is null
            and (t.expires_at is null or t.expires_at > now())) >= 20 then
        raise exception 'at most 20 active tokens; revoke one first' using errcode = '54000';
      end if;

      v_token := 'alc_pat_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
      insert into public.personal_access_tokens (user_id, name, token_prefix, token_hash, access, expires_at)
      values (
        v_uid, v_name, left(v_token, 12),
        encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
        v_access,
        case when p_expires_days is null then null else now() + make_interval(days => p_expires_days) end
      )
      returning id into v_id;

      -- The only time the plaintext leaves the database.
      return jsonb_build_object('id', v_id, 'token', v_token);
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.create_personal_access_token(text, integer, text) from public, anon';
  execute 'grant execute on function public.create_personal_access_token(text, integer, text) to authenticated';

  execute $ddl$
    create or replace function public.revoke_personal_access_token(p_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      v_uid uuid := auth.uid();
    begin
      if v_uid is null then
        raise exception 'not signed in' using errcode = '42501';
      end if;
      if public.is_delegated_request() then
        raise exception 'personal access tokens can only be revoked from the Alcon app' using errcode = '42501';
      end if;
      update public.personal_access_tokens t
         set revoked_at = now()
       where t.id = p_id and t.user_id = v_uid and t.revoked_at is null;
      if not found and not exists (
        select 1 from public.personal_access_tokens t where t.id = p_id and t.user_id = v_uid
      ) then
        raise exception 'token not found' using errcode = 'P0002';
      end if;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.revoke_personal_access_token(uuid) from public, anon';
  execute 'grant execute on function public.revoke_personal_access_token(uuid) to authenticated';

  execute $ddl$
    create or replace function public.resolve_personal_access_token(p_hash text, p_client text default null)
    returns table (user_id uuid, id uuid, name text, access text)
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    #variable_conflict use_column
    declare
      r record;
    begin
      if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then
        return;
      end if;
      select t.id as token_id, t.user_id as owner_id, t.name as token_name, t.access as token_access, t.last_used_at as used_at
        into r
        from public.personal_access_tokens t
        join auth.users u on u.id = t.user_id
       where t.token_hash = p_hash
         and t.revoked_at is null
         and (t.expires_at is null or t.expires_at > now())
         and u.deleted_at is null
         and (u.banned_until is null or u.banned_until <= now())
         and not coalesce(u.is_anonymous, false);
      if not found then
        return;
      end if;
      -- Last use is a hint for the owner's list, not an audit log: write it at
      -- most once a minute so a busy client does not rewrite the row per call.
      if r.used_at is null or r.used_at < now() - interval '1 minute' then
        update public.personal_access_tokens t
           set last_used_at = now(),
               last_used_client = nullif(left(btrim(coalesce(p_client, '')), 80), '')
         where t.id = r.token_id;
      end if;
      return query select r.owner_id, r.token_id, r.token_name, r.token_access;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.resolve_personal_access_token(text, text) from public, anon, authenticated';
  execute 'grant execute on function public.resolve_personal_access_token(text, text) to service_role';
end
$$;

-- An Alcon token is never an integration credential: an agent holding one
-- could reach Alcon outside its own run. Same definition as before, plus that
-- refusal.
do $$
begin
  if to_regclass('public.integrations') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault')
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'set_integration_secret skipped: integrations, vault or is_activity_space_owner not present';
    return;
  end if;

  execute $ddl$
    create or replace function public.set_integration_secret(p_integration_id uuid, p_secret text)
    returns void
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_space uuid;
      v_secret_id uuid;
      v_name text := 'integration:' || p_integration_id::text;
    begin
      select activity_space_id into v_space from public.integrations where id = p_integration_id;
      if v_space is null or not public.is_activity_space_owner(v_space) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      -- Anywhere in the value: "Bearer alc_pat_…" for a header credential,
      -- leading whitespace, or a token inside a JSON blob are all refused.
      if p_secret is not null and position('alc_pat_' in p_secret) > 0 then
        raise exception 'An Alcon personal access token cannot be used as an integration credential.' using errcode = '22023';
      end if;
      -- The secret is found by its name, never by a secret_id a row claims.
      select id into v_secret_id from vault.secrets where name = v_name;
      if p_secret is null or length(p_secret) = 0 then
        if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
        update public.integrations set secret_id = null, updated_at = now() where id = p_integration_id;
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
end
$$;
