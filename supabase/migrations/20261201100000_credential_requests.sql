-- Credential requests: the capture front door's record (secure-login).
--
-- A credential request is a row the SERVER writes when a real need
-- exists — a connection whose Vault slot is empty or refused, a run
-- parked on a missing credential, the runner facing a login wall.
-- The client renders it as the capture card/dialog; the person answers
-- it on a system surface. There is deliberately no path by which a
-- model authors one freely: creation is service-role / driver work
-- (PR2 wires the creators), and the table grants browsers nothing but
-- reads.
--
--   credential_requests     kind (integration_secret | site_login),
--                           the row the need is about, and for site
--                           logins the origin — server-derived from
--                           the runner's own page report or an existing
--                           row, never model-supplied text. Status
--                           moves pending → saved | used_once |
--                           declined | expired | superseded; pending
--                           requests lapse (+7 days from chat, run
--                           lifetime +1 day from a run — the tick that
--                           lapses them lands with PR2).
--   set_site_credential     the capture dialog's submit for the site
--                           class, addressed by REQUEST id: the RPC
--                           reads the origin off the pending request
--                           row, so a browser cannot be tricked into
--                           filing a password under an origin other
--                           than the one the dialog displayed. The
--                           storage itself is the by-origin RPC of
--                           20261201090000 (owner check, D5 refusal and
--                           audit included); a stored/replaced answer
--                           marks the request saved, with who decided.
--
-- The use-once stash (stash/take_credential_once) and the transcript
-- step kind land with PR2, which renders this table.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.site_credentials') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.set_site_credential_by_origin(uuid, text, text, text, text, boolean)') is null then
    raise notice 'credential requests skipped: activity_spaces, site_credentials, is_activity_space_member or set_site_credential_by_origin not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.credential_requests (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      kind text not null check (kind in ('integration_secret', 'site_login')),
      integration_id uuid references public.integrations(id) on delete set null,
      site_credential_id uuid references public.site_credentials(id) on delete set null,
      origin text,
      username_hint text,
      need jsonb not null default '{}'::jsonb,
      status text not null default 'pending' check (status in ('pending', 'saved', 'used_once', 'declined', 'expired', 'superseded')),
      requested_by uuid,
      decided_by uuid,
      decided_at timestamptz,
      expires_at timestamptz,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists credential_requests_space_idx on public.credential_requests (activity_space_id, status, created_at desc)';
  execute 'alter table public.credential_requests enable row level security';
  -- Members read the asks in their Space (the card re-reads its row
  -- live, so a stale ask shows its true state); nobody writes the
  -- table directly — the service role creates requests and the
  -- decision RPCs move them.
  execute 'revoke all on table public.credential_requests from public, anon, authenticated';
  execute 'grant select on table public.credential_requests to authenticated';
  execute 'drop policy if exists credential_requests_select on public.credential_requests';
  execute $ddl$
    create policy credential_requests_select on public.credential_requests
      for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $ddl$;

  -- ── The capture submit for the site class, addressed by request ────
  execute $ddl$
    create or replace function public.set_site_credential(
      p_request_id uuid,
      p_username text,
      p_password text
    )
    returns text
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_req public.credential_requests%rowtype;
      v_username text;
      v_status text;
    begin
      select * into v_req from public.credential_requests where id = p_request_id;
      if not found then
        raise exception 'credential request not found' using errcode = 'P0002';
      end if;
      if v_req.kind <> 'site_login' then
        raise exception 'this request is not for a site login' using errcode = '22023';
      end if;
      if v_req.status <> 'pending' then
        raise exception 'this credential request is no longer pending' using errcode = '22023';
      end if;
      if v_req.origin is null then
        raise exception 'this credential request names no site' using errcode = '22023';
      end if;
      -- Capture enters a credential; clearing one lives in Settings
      -- (the by-origin form). An empty submit here is a form error,
      -- not a silent delete.
      if p_password is null or length(p_password) = 0 then
        raise exception 'enter the password to save it' using errcode = '22023';
      end if;
      -- What the person typed is what gets stored; an untouched field
      -- keeps the hint the dialog was prefilled with.
      v_username := nullif(btrim(coalesce(p_username, '')), '');
      if v_username is null then
        v_username := nullif(btrim(coalesce(v_req.username_hint, '')), '');
      end if;
      if v_username is null then
        raise exception 'Enter the username for this site login.' using errcode = '22023';
      end if;

      -- The origin comes off the request row — the one the dialog
      -- displayed, locked. The by-origin RPC re-checks the owner
      -- (D1), the covered-host refusal (D5) and writes the audit.
      v_status := public.set_site_credential_by_origin(
        v_req.activity_space_id, v_req.origin, v_username, p_password, null, false);
      if v_status in ('stored', 'replaced') then
        update public.credential_requests
           set status = 'saved',
               decided_by = auth.uid(),
               decided_at = now(),
               site_credential_id = (
                 select id from public.site_credentials
                  where activity_space_id = v_req.activity_space_id
                    and origin = public.normalize_site_origin(v_req.origin)
               )
         where id = p_request_id and status = 'pending';
      end if;
      return v_status;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.set_site_credential(uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.set_site_credential(uuid, text, text) to authenticated';
end
$$;
