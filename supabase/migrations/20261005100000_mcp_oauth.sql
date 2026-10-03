-- MCP over OAuth (ELE_PLT-004, ADR 0034).
--
-- claude.ai and ChatGPT connect through Supabase Auth's OAuth 2.1 server:
-- the person signs in to Alcon, approves the client on /oauth/consent, and
-- the client gets an access token for them that carries `client_id`.
--
--   alcon_oauth_client           a role with no privileges. The access token
--                                hook gives it to every token issued to an
--                                OAuth client, so such a token cannot read or
--                                write through PostgREST, Storage or Realtime.
--                                It reaches the board only through alcon-mcp,
--                                which mints its own short-lived JWT for the
--                                person (ADR 0032) and offers the allowlist.
--   custom_access_token_hook     Supabase Auth's "Customize Access Token"
--                                hook. A token without client_id (the app's
--                                own sessions) is returned unchanged.
--   oauth_client_access          what the person allowed a client: 'read' or
--                                'read_write'. Written by
--                                set_oauth_client_access; the owner reads and
--                                deletes their own rows. No row means read.
--   resolve_oauth_caller         service role only: the client's name and the
--                                allowed access, while the person's consent
--                                to that client stands.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'alcon_oauth_client') then
    execute 'create role alcon_oauth_client nologin noinherit';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'grant alcon_oauth_client to authenticator';
  end if;
end
$$;

do $$
begin
  execute $ddl$
    create or replace function public.custom_access_token_hook(event jsonb)
    returns jsonb
    language plpgsql
    stable
    set search_path = ''
    as $f$
    begin
      if coalesce(event->'claims'->>'client_id', '') = '' then
        return event;
      end if;
      return jsonb_set(event, '{claims,role}', to_jsonb('alcon_oauth_client'::text));
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated';
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin';
  end if;
end
$$;

do $$
begin
  if to_regclass('auth.users') is null
     or to_regprocedure('public.is_delegated_request()') is null then
    raise notice 'oauth_client_access skipped: auth.users or is_delegated_request not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.oauth_client_access (
      user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
      client_id uuid not null,
      access text not null default 'read' check (access in ('read', 'read_write')),
      updated_at timestamptz not null default now(),
      primary key (user_id, client_id)
    )
  $ddl$;
  execute 'alter table public.oauth_client_access enable row level security';
  execute 'revoke all on table public.oauth_client_access from public, anon, authenticated';
  execute 'grant select, delete on public.oauth_client_access to authenticated';

  execute 'drop policy if exists oauth_client_access_select_own on public.oauth_client_access';
  execute $ddl$
    create policy oauth_client_access_select_own on public.oauth_client_access
      for select to authenticated
      using (user_id = (select auth.uid()) and not (select public.is_delegated_request()))
  $ddl$;
  execute 'drop policy if exists oauth_client_access_delete_own on public.oauth_client_access';
  execute $ddl$
    create policy oauth_client_access_delete_own on public.oauth_client_access
      for delete to authenticated
      using (user_id = (select auth.uid()) and not (select public.is_delegated_request()))
  $ddl$;

  execute $ddl$
    create or replace function public.set_oauth_client_access(p_client_id uuid, p_access text)
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
        raise exception 'connected apps can only be changed from the Alcon app' using errcode = '42501';
      end if;
      if p_access is null or p_access not in ('read', 'read_write') then
        raise exception 'access must be read or read_write' using errcode = '22023';
      end if;
      if p_client_id is null then
        raise exception 'client not found' using errcode = 'P0002';
      end if;
      if to_regclass('auth.oauth_clients') is not null then
        if not exists (select 1 from auth.oauth_clients c where c.id = p_client_id and c.deleted_at is null) then
          raise exception 'client not found' using errcode = 'P0002';
        end if;
      end if;
      insert into public.oauth_client_access (user_id, client_id, access, updated_at)
      values (v_uid, p_client_id, p_access, now())
      on conflict (user_id, client_id) do update set access = excluded.access, updated_at = now();
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.set_oauth_client_access(uuid, text) from public, anon';
  execute 'grant execute on function public.set_oauth_client_access(uuid, text) to authenticated';

  -- Reads auth.oauth_consents / auth.oauth_clients, which exist once the
  -- project has the OAuth server; without them nobody can hold a grant.
  execute $ddl$
    create or replace function public.resolve_oauth_caller(p_user_id uuid, p_client_id uuid)
    returns table (client_name text, access text)
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    begin
      if p_user_id is null or p_client_id is null
         or to_regclass('auth.oauth_consents') is null or to_regclass('auth.oauth_clients') is null then
        return;
      end if;
      return query execute
        'select coalesce(nullif(btrim(c.client_name), ''''), ''OAuth client''),
                coalesce((select a.access from public.oauth_client_access a
                           where a.user_id = $1 and a.client_id = $2), ''read'')
           from auth.oauth_clients c
          where c.id = $2 and c.deleted_at is null
            and exists (select 1 from auth.oauth_consents g
                         where g.user_id = $1 and g.client_id = $2 and g.revoked_at is null)'
        using p_user_id, p_client_id;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.resolve_oauth_caller(uuid, uuid) from public, anon, authenticated';
  execute 'grant execute on function public.resolve_oauth_caller(uuid, uuid) to service_role';
end
$$;
