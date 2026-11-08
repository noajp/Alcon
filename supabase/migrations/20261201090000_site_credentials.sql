-- Site credentials: website username/password logins (secure-login PR1).
--
-- A website with no API, no MCP server and no OAuth — only a login form —
-- had no credential class at all: the person pre-signed-in by hand in
-- the runner's browser, or pasted a password into chat. This migration
-- gives that work a stored credential, extending the Vault pattern
-- exactly (one secret per row, found by name; owners write through an
-- RPC; only the service role reads back):
--
--   site_credentials          one row per site login in a Space:
--                             metadata (origin, username, label,
--                             last_test) members can read; the password
--                             itself lives only in Vault as the secret
--                             `site-credential:<row id>`, a JSON pair
--                             {"username","password"} so the pair the
--                             runner needs travels as one value through
--                             one read. Unique per (Space, origin): the
--                             stored origin is the credential's
--                             identity.
--   normalize_site_origin     the canonical form every write passes
--                             through: scheme://host[:port], host
--                             lowercased, default port dropped, path
--                             and userinfo refused. A credential filed
--                             under one origin can never be re-aimed
--                             at another.
--   set_site_credential_by_origin
--                             the owner-only write (decision D1).
--                             Empty password = delete the secret (the
--                             set_integration_secret idiom); the row
--                             stays with secret_id null so the audit
--                             trail keeps its referent. Refuses —
--                             decision D5 — an origin whose host an
--                             existing connection in the Space already
--                             covers (a stored password there would be
--                             a second route to the same capability);
--                             p_force is the owner's Settings override
--                             after the warning. Returns what happened:
--                             stored | replaced | deleted | noop |
--                             covered_by_connection.
--   get_site_credential       service role only: the one read, by
--                             secret name, never by a row's claim.
--   credential_uses           append-only audit of every credential
--                             touch (never a value). PR1's RPCs write
--                             the lifecycle events (stored / replaced /
--                             deleted); the use events join with the
--                             runner release (PR3) and lazyBinding
--                             (PR4). Owners read; nobody writes from a
--                             browser.
--   trg_site_credentials_drop_secret
--                             a deleted row takes its Vault secret
--                             with it, like integrations.
--
-- The request-addressed write (set_site_credential) and the
-- credential_requests table land in 20261201100000, with the capture
-- front door (secure-login PR2).
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.integrations') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault')
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'site credentials skipped: activity_spaces, integrations, vault, is_activity_space_owner or is_activity_space_member not present';
    return;
  end if;

  -- ── The canonical origin ────────────────────────────────────────────
  -- scheme://host[:port]; a missing scheme reads as https (a Settings
  -- form convenience — what is STORED is always canonical). IPv6
  -- literal hosts are refused (their ':' breaks the host/port split);
  -- a website login on a bare IPv6 address is out of scope.
  execute $ddl$
    create or replace function public.normalize_site_origin(p_origin text)
    returns text
    language plpgsql
    immutable
    set search_path = ''
    as $f$
    declare
      v text := lower(btrim(coalesce(p_origin, '')));
      v_scheme text;
      v_authority text;
      v_host text;
      v_port text;
    begin
      if v = '' then return null; end if;
      if position('://' in v) = 0 then v := 'https://' || v; end if;
      v_scheme := split_part(v, '://', 1);
      if v_scheme not in ('http', 'https') then return null; end if;
      v_authority := split_part(split_part(split_part(v, '://', 2), '/', 1), '?', 1);
      v_authority := split_part(v_authority, '#', 1);
      if position('@' in v_authority) > 0 then return null; end if;
      if (length(v_authority) - length(replace(v_authority, ':', ''))) > 1 then return null; end if;
      if position(':' in v_authority) > 0 then
        v_host := split_part(v_authority, ':', 1);
        v_port := split_part(v_authority, ':', 2);
        if v_port !~ '^[0-9]+$' or v_port::integer > 65535 then return null; end if;
        if (v_scheme = 'https' and v_port = '443') or (v_scheme = 'http' and v_port = '80') then
          v_port := null;
        end if;
      else
        v_host := v_authority;
        v_port := null;
      end if;
      if v_host = '' or v_host ~ '[^a-z0-9.\-]' or v_host !~ '[a-z0-9]' then return null; end if;
      return v_scheme || '://' || v_host || coalesce(':' || v_port, '');
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.normalize_site_origin(text) from public, anon, authenticated';
  execute 'grant execute on function public.normalize_site_origin(text) to service_role';

  -- ── The store ───────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.site_credentials (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      origin text not null check (origin ~ '^https?://[a-z0-9.\-]+(:[0-9]{1,5})?$'),
      username text not null check (char_length(username) between 1 and 320),
      label text check (label is null or char_length(label) <= 120),
      secret_id uuid,
      last_test jsonb,
      created_by uuid default auth.uid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (activity_space_id, origin)
    )
  $ddl$;
  execute 'create index if not exists site_credentials_space_idx on public.site_credentials (activity_space_id, created_at)';
  execute 'alter table public.site_credentials enable row level security';
  -- Members read the metadata (the external_account precedent: knowing a
  -- login exists for an origin is display data); nobody writes the
  -- table directly — rows are born and changed only through the RPCs.
  -- An owner may delete a row outright; the trigger drops its secret.
  execute 'revoke all on table public.site_credentials from public, anon, authenticated';
  execute 'grant select, delete on table public.site_credentials to authenticated';
  execute 'drop policy if exists site_credentials_select on public.site_credentials';
  execute $ddl$
    create policy site_credentials_select on public.site_credentials
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $ddl$;
  execute 'drop policy if exists site_credentials_delete on public.site_credentials';
  execute $ddl$
    create policy site_credentials_delete on public.site_credentials
      for delete to authenticated
      using (public.is_activity_space_owner(activity_space_id))
  $ddl$;

  -- ── The audit ───────────────────────────────────────────────────────
  execute $ddl$
    create table if not exists public.credential_uses (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      credential_kind text not null check (credential_kind in ('integration', 'site', 'once')),
      integration_id uuid references public.integrations(id) on delete set null,
      site_credential_id uuid references public.site_credentials(id) on delete set null,
      event text not null check (event in ('stored', 'replaced', 'deleted', 'declined', 'used', 'test_failed', 'release_refused')),
      run_id uuid,
      actor_id uuid,
      origin text,
      detail text,
      created_at timestamptz not null default now(),
      check (
        (credential_kind = 'integration' and integration_id is not null and site_credential_id is null)
        or (credential_kind = 'site' and site_credential_id is not null and integration_id is null)
        or (credential_kind = 'once' and integration_id is null and site_credential_id is null)
      )
    )
  $ddl$;
  execute 'create index if not exists credential_uses_space_idx on public.credential_uses (activity_space_id, created_at desc)';
  execute 'create index if not exists credential_uses_site_idx on public.credential_uses (site_credential_id, created_at desc) where site_credential_id is not null';
  execute 'alter table public.credential_uses enable row level security';
  -- Append-only from every browser: owners read their Space's trail;
  -- no role but the service role and the definer RPCs can write a row.
  execute 'revoke all on table public.credential_uses from public, anon, authenticated';
  execute 'grant select on table public.credential_uses to authenticated';
  execute 'drop policy if exists credential_uses_select on public.credential_uses';
  execute $ddl$
    create policy credential_uses_select on public.credential_uses
      for select to authenticated
      using (public.is_activity_space_owner(activity_space_id))
  $ddl$;

  -- A run reference that survives the run's deletion (the trail keeps
  -- its story in `origin` and `detail` either way).
  if to_regclass('public.agent_runs') is not null then
    execute 'alter table public.credential_uses drop constraint if exists credential_uses_run_fk';
    execute 'alter table public.credential_uses add constraint credential_uses_run_fk foreign key (run_id) references public.agent_runs(id) on delete set null';
  end if;

  -- ── The write: owner-only, by origin (the Settings path) ────────────
  execute $ddl$
    create or replace function public.set_site_credential_by_origin(
      p_activity_space_id uuid,
      p_origin text,
      p_username text,
      p_password text,
      p_label text default null,
      p_force boolean default false
    )
    returns text
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_origin text := public.normalize_site_origin(p_origin);
      v_row public.site_credentials%rowtype;
      v_secret_id uuid;
      v_name text;
      v_event text;
    begin
      if p_activity_space_id is null or not public.is_activity_space_owner(p_activity_space_id) then
        raise exception 'not allowed' using errcode = '42501';
      end if;
      if v_origin is null then
        raise exception 'Enter a site address like https://example.com.' using errcode = '22023';
      end if;

      -- Empty password = delete (the set_integration_secret idiom): the
      -- secret goes, the row stays with secret_id null so the audit
      -- trail keeps its referent. No username is needed to delete.
      if p_password is null or length(p_password) = 0 then
        select * into v_row from public.site_credentials
         where activity_space_id = p_activity_space_id and origin = v_origin;
        if not found then return 'noop'; end if;
        v_name := 'site-credential:' || v_row.id::text;
        select id into v_secret_id from vault.secrets where name = v_name;
        if v_secret_id is null and v_row.secret_id is null then return 'noop'; end if;
        if v_secret_id is not null then delete from vault.secrets where id = v_secret_id; end if;
        update public.site_credentials
           set secret_id = null, last_test = null, updated_at = now()
         where id = v_row.id;
        insert into public.credential_uses (activity_space_id, credential_kind, site_credential_id, event, actor_id, origin)
        values (p_activity_space_id, 'site', v_row.id, 'deleted', auth.uid(), v_origin);
        return 'deleted';
      end if;

      -- An Alcon token is never a credential, here either (the
      -- set_integration_secret refusal, mirrored).
      if position('alc_pat_' in p_password) > 0 then
        raise exception 'An Alcon personal access token cannot be stored as a site password.' using errcode = '22023';
      end if;
      if btrim(coalesce(p_username, '')) = '' then
        raise exception 'Enter the username for this site login.' using errcode = '22023';
      end if;

      -- D5: a connection in this Space already covering this host is
      -- the route to it; a stored password would duplicate that route.
      -- The owner may still force it from Settings (p_force), after
      -- the warning the dialog shows.
      if not coalesce(p_force, false) and exists (
        select 1 from public.integrations i
         where i.activity_space_id = p_activity_space_id
           and lower(substring(i.endpoint from '^https?://([^/:?#]+)')) = substring(v_origin from '^https?://([^/:]+)')
      ) then
        return 'covered_by_connection';
      end if;

      select * into v_row from public.site_credentials
       where activity_space_id = p_activity_space_id and origin = v_origin
       for update;
      if not found then
        insert into public.site_credentials (activity_space_id, origin, username, label)
        values (p_activity_space_id, v_origin, btrim(p_username), nullif(btrim(coalesce(p_label, '')), ''))
        returning * into v_row;
      end if;

      -- The secret is found by its name, never by a secret_id a row claims.
      v_name := 'site-credential:' || v_row.id::text;
      select id into v_secret_id from vault.secrets where name = v_name;
      if v_secret_id is null then
        v_secret_id := vault.create_secret(
          jsonb_build_object('username', btrim(p_username), 'password', p_password)::text,
          v_name, 'Alcon site credential');
        v_event := 'stored';
      else
        perform vault.update_secret(v_secret_id,
          jsonb_build_object('username', btrim(p_username), 'password', p_password)::text);
        v_event := 'replaced';
      end if;
      update public.site_credentials
         set username = btrim(p_username),
             label = case when p_label is null then label else nullif(btrim(p_label), '') end,
             secret_id = v_secret_id,
             last_test = null,
             updated_at = now()
       where id = v_row.id;
      insert into public.credential_uses (activity_space_id, credential_kind, site_credential_id, event, actor_id, origin)
      values (p_activity_space_id, 'site', v_row.id, v_event, auth.uid(), v_origin);
      return v_event;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.set_site_credential_by_origin(uuid, text, text, text, text, boolean) from public, anon, authenticated';
  execute 'grant execute on function public.set_site_credential_by_origin(uuid, text, text, text, text, boolean) to authenticated';

  -- ── The read: service role only ─────────────────────────────────────
  execute $ddl$
    create or replace function public.get_site_credential(p_site_credential_id uuid)
    returns text
    language sql
    stable
    security definer
    set search_path = public, vault
    as $f$
      select ds.decrypted_secret
      from vault.decrypted_secrets ds
      where ds.name = 'site-credential:' || p_site_credential_id::text
    $f$
  $ddl$;
  execute 'revoke all on function public.get_site_credential(uuid) from public';
  execute 'revoke all on function public.get_site_credential(uuid) from authenticated';
  execute 'revoke all on function public.get_site_credential(uuid) from anon';
  execute 'grant execute on function public.get_site_credential(uuid) to service_role';

  -- ── Lifecycle: a deleted row takes its secret with it ──────────────
  execute $ddl$
    create or replace function public.site_credentials_drop_secret()
    returns trigger
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    begin
      delete from vault.secrets where name = 'site-credential:' || old.id::text;
      return old;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.site_credentials_drop_secret() from public, anon, authenticated';
  execute 'drop trigger if exists trg_site_credentials_drop_secret on public.site_credentials';
  execute 'create trigger trg_site_credentials_drop_secret after delete on public.site_credentials
             for each row execute function public.site_credentials_drop_secret()';
end
$$;
