-- Asset relay (ADR 0036): a local app or AI joins a Space by announcing
-- itself through the asset-relay Edge Function, and is recognized when a
-- Space owner accepts it.
--
--   assets            one row per announced app / AI. `manifest` is what the
--                     app says about itself (self-reported); `observed` is
--                     what the relay saw of the connection. Members read;
--                     only the owner accepts or revokes, through RPCs; the
--                     relay writes with the service role.
--   asset_events      what the asset did, in its own words: kind, summary,
--                     payload. Members read; only the relay writes.
--   announce_asset    service role only: creates an unclaimed asset for a
--                     Space, caps unclaimed announcements per Space, and
--                     notifies the Space's owners (kind asset_announced).
--   resolve_asset_token service role only: hash → asset id, Space, status.
--   touch_asset       service role only: a repeated hello refreshes the
--                     manifest and last_seen_at.
--   record_asset_events service role only: appends events, refuses a
--                     revoked asset.
--   accept_asset      a Space owner recognizes an unclaimed asset.
--   revoke_asset      a Space owner stops an asset; its next call is refused.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.activity_spaces') is null
     or to_regclass('public.activity_space_members') is null
     or to_regclass('public.notifications') is null
     or to_regclass('auth.users') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'asset relay skipped: activity_spaces, notifications, auth.users or the Space helpers not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.assets (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      name text not null check (char_length(btrim(name)) between 1 and 120),
      kind text not null default 'app' check (kind in ('app', 'ai_agent', 'script', 'service', 'other')),
      status text not null default 'unclaimed' check (status in ('unclaimed', 'active', 'revoked')),
      manifest jsonb not null default '{}'::jsonb,
      observed jsonb not null default '{}'::jsonb,
      token_prefix text not null,
      token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
      claimed_by uuid references auth.users(id) on delete set null,
      claimed_at timestamptz,
      revoked_at timestamptz,
      last_seen_at timestamptz,
      event_count integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists assets_space_idx on public.assets (activity_space_id, status, created_at desc)';
  execute 'alter table public.assets enable row level security';
  -- Nobody writes the table directly; members read every column but the hash.
  execute 'revoke all on table public.assets from public, anon, authenticated';
  execute 'grant select (id, activity_space_id, name, kind, status, manifest, observed, token_prefix, claimed_by, claimed_at, revoked_at, last_seen_at, event_count, created_at, updated_at)
             on public.assets to authenticated';
  execute 'drop policy if exists assets_select on public.assets';
  execute $ddl$
    create policy assets_select on public.assets for select to authenticated
      using (public.is_activity_space_member(activity_space_id))
  $ddl$;

  execute $ddl$
    create table if not exists public.asset_events (
      id uuid primary key default gen_random_uuid(),
      asset_id uuid not null references public.assets(id) on delete cascade,
      kind text not null check (char_length(btrim(kind)) between 1 and 60),
      summary text not null check (char_length(summary) between 1 and 300),
      payload jsonb,
      occurred_at timestamptz not null default now(),
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists asset_events_asset_idx on public.asset_events (asset_id, occurred_at desc)';
  execute 'alter table public.asset_events enable row level security';
  execute 'revoke all on table public.asset_events from public, anon, authenticated';
  execute 'grant select on public.asset_events to authenticated';
  execute 'drop policy if exists asset_events_select on public.asset_events';
  execute $ddl$
    create policy asset_events_select on public.asset_events for select to authenticated
      using (exists (select 1 from public.assets a where a.id = asset_id and public.is_activity_space_member(a.activity_space_id)))
  $ddl$;

  -- An announcement reaches the Space's owners through the Inbox.
  execute 'alter table public.notifications drop constraint if exists notifications_kind_check';
  execute 'alter table public.notifications add constraint notifications_kind_check check (kind = any (array[
    ''mention'', ''assigned'', ''comment'', ''status_change'', ''approval_requested'',
    ''approval_decided'', ''due_soon'', ''review_due'', ''invite'', ''asset_announced''
  ]::text[]))';

  execute $ddl$
    create or replace function public.announce_asset(
      p_space uuid, p_name text, p_kind text, p_manifest jsonb, p_observed jsonb,
      p_token_hash text, p_token_prefix text
    )
    returns uuid
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      v_id uuid;
      v_name text := left(btrim(coalesce(p_name, '')), 120);
      v_kind text := coalesce(p_kind, 'app');
      v_owner uuid;
    begin
      if not exists (select 1 from public.activity_spaces s where s.id = p_space) then
        raise exception 'space not found' using errcode = 'P0002';
      end if;
      if char_length(v_name) = 0 then
        raise exception 'name required' using errcode = '22023';
      end if;
      if v_kind not in ('app', 'ai_agent', 'script', 'service', 'other') then
        v_kind := 'other';
      end if;
      -- The announcement is unauthenticated, so a Space can only hold so many
      -- unrecognized ones at a time. Owners revoke the noise to make room.
      if (select count(*) from public.assets a where a.activity_space_id = p_space and a.status = 'unclaimed') >= 100 then
        raise exception 'too many unrecognized assets in this Space' using errcode = 'P0003';
      end if;
      insert into public.assets (activity_space_id, name, kind, manifest, observed, token_hash, token_prefix, last_seen_at)
      values (p_space, v_name, v_kind, coalesce(p_manifest, '{}'::jsonb), coalesce(p_observed, '{}'::jsonb), p_token_hash, p_token_prefix, now())
      returning id into v_id;
      for v_owner in
        select m.user_id from public.activity_space_members m where m.activity_space_id = p_space and m.role = 'owner'
      loop
        insert into public.notifications (recipient_id, actor_name, kind, title, body)
        values (v_owner, v_name, 'asset_announced',
                v_name || ' is asking to join this Space',
                'An app or AI announced itself through the asset relay. It is not recognized until you accept it in Settings › Integrations › Connected assets. What it reports about itself is unverified.');
      end loop;
      return v_id;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.announce_asset(uuid, text, text, jsonb, jsonb, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.announce_asset(uuid, text, text, jsonb, jsonb, text, text) to service_role';

  execute $ddl$
    create or replace function public.resolve_asset_token(p_hash text)
    returns table (id uuid, activity_space_id uuid, name text, status text, claimed_at timestamptz)
    language sql
    security definer
    set search_path = ''
    as $f$
      select a.id, a.activity_space_id, a.name, a.status, a.claimed_at
        from public.assets a
       where p_hash ~ '^[0-9a-f]{64}$' and a.token_hash = p_hash
    $f$
  $ddl$;
  execute 'revoke all on function public.resolve_asset_token(text) from public, anon, authenticated';
  execute 'grant execute on function public.resolve_asset_token(text) to service_role';

  execute $ddl$
    create or replace function public.touch_asset(p_asset_id uuid, p_manifest jsonb, p_observed jsonb)
    returns void
    language sql
    security definer
    set search_path = ''
    as $f$
      update public.assets a
         set manifest = a.manifest || coalesce(p_manifest, '{}'::jsonb),
             observed = a.observed || coalesce(p_observed, '{}'::jsonb),
             last_seen_at = now(),
             updated_at = now()
       where a.id = p_asset_id and a.status <> 'revoked'
    $f$
  $ddl$;
  execute 'revoke all on function public.touch_asset(uuid, jsonb, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.touch_asset(uuid, jsonb, jsonb) to service_role';

  execute $ddl$
    create or replace function public.record_asset_events(p_asset_id uuid, p_events jsonb)
    returns integer
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      v_status text;
      v_count integer;
    begin
      select a.status into v_status from public.assets a where a.id = p_asset_id for update;
      if v_status is null then
        raise exception 'asset not found' using errcode = 'P0002';
      end if;
      if v_status = 'revoked' then
        raise exception 'asset revoked' using errcode = '42501';
      end if;
      if p_events is null or jsonb_typeof(p_events) <> 'array' then
        raise exception 'events must be an array' using errcode = '22023';
      end if;
      insert into public.asset_events (asset_id, kind, summary, payload, occurred_at)
      select p_asset_id,
             left(btrim(coalesce(e->>'kind', 'event')), 60),
             left(coalesce(nullif(btrim(e->>'summary'), ''), '(no summary)'), 300),
             e->'payload',
             coalesce((e->>'occurred_at')::timestamptz, now())
        from jsonb_array_elements(p_events) with ordinality as x(e, n)
       where n <= 50;
      get diagnostics v_count = row_count;
      update public.assets a
         set event_count = a.event_count + v_count, last_seen_at = now(), updated_at = now()
       where a.id = p_asset_id;
      return v_count;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.record_asset_events(uuid, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.record_asset_events(uuid, jsonb) to service_role';

  execute $ddl$
    create or replace function public.accept_asset(p_asset_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      v_space uuid;
      v_status text;
    begin
      select a.activity_space_id, a.status into v_space, v_status from public.assets a where a.id = p_asset_id for update;
      if v_space is null then
        raise exception 'asset not found' using errcode = 'P0002';
      end if;
      if not public.is_activity_space_owner(v_space) then
        raise exception 'only a Space owner can accept an asset' using errcode = '42501';
      end if;
      if v_status <> 'unclaimed' then
        raise exception 'asset is not waiting for acceptance' using errcode = '22023';
      end if;
      update public.assets a
         set status = 'active', claimed_by = auth.uid(), claimed_at = now(), updated_at = now()
       where a.id = p_asset_id;
      insert into public.asset_events (asset_id, kind, summary)
      values (p_asset_id, 'accepted', 'Accepted into the Space by its owner');
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.accept_asset(uuid) from public, anon';
  execute 'grant execute on function public.accept_asset(uuid) to authenticated';

  execute $ddl$
    create or replace function public.revoke_asset(p_asset_id uuid)
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $f$
    declare
      v_space uuid;
      v_status text;
    begin
      select a.activity_space_id, a.status into v_space, v_status from public.assets a where a.id = p_asset_id for update;
      if v_space is null then
        raise exception 'asset not found' using errcode = 'P0002';
      end if;
      if not public.is_activity_space_owner(v_space) then
        raise exception 'only a Space owner can revoke an asset' using errcode = '42501';
      end if;
      if v_status = 'revoked' then
        return;
      end if;
      update public.assets a
         set status = 'revoked', revoked_at = now(), updated_at = now()
       where a.id = p_asset_id;
      insert into public.asset_events (asset_id, kind, summary)
      values (p_asset_id, 'revoked', 'Revoked by a Space owner; its next call is refused');
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.revoke_asset(uuid) from public, anon';
  execute 'grant execute on function public.revoke_asset(uuid) to authenticated';
end
$$;
