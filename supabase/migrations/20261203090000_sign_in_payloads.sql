-- Sign-in payloads (secure-login PR3): how a stored pair reaches the
-- runner at the moment of a fill — and nowhere else.
--
-- The release path (run-agent) has already decided, server-side,
-- that this call may spend this credential on this origin (triple
-- origin equality). What remains is transport, and the obvious
-- vehicle is wrong: asset_calls.input is readable by every member of
-- the asset's Space (20261110120000 — the run's audit trail), so a
-- password sitting in that column, even for seconds and even
-- scrubbed afterwards, would be a value outside the Vault readable
-- by people who may not read values. Instead the pair takes the
-- one-time stash's route (20261006090000 / 20261202090000):
--
--   stage_sign_in_payload   service role only: the releasing server
--                           writes the pair into Vault as
--                           `sign-in:<asset call id>` — addressed by
--                           the call, never by a runner's or a
--                           model's claim.
--   take_sign_in_payload    service role only: the asset relay, at
--                           the moment it hands the claimed call to
--                           the runner, takes the pair and deletes
--                           the secret in the same call. The HTTP
--                           response to the asset's own token is the
--                           only place the value ever travels; the
--                           stored call row carries just the origin
--                           the fill must match. The releaser takes
--                           again after the call settles, burning a
--                           payload that was never delivered — a
--                           second take returns nothing, so the
--                           burn is safe in every order.
--
-- No browser role can call either function, and neither returns
-- anything to one: stage returns void, take is the relay's door.
--
-- Guarded for preview replay (the base schema lives outside this folder).
do $$
begin
  if to_regclass('public.asset_calls') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'sign-in payloads skipped: asset_calls or vault not present';
    return;
  end if;

  -- ── The stage: the releasing server arms one call ────────────────
  execute $ddl$
    create or replace function public.stage_sign_in_payload(
      p_call_id uuid,
      p_pair text
    )
    returns void
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_name text := 'sign-in:' || p_call_id::text;
      v_secret_id uuid;
    begin
      if p_call_id is null or p_pair is null or length(p_pair) = 0 then
        raise exception 'a call and its pair are required' using errcode = '22023';
      end if;
      if not exists (select 1 from public.asset_calls where id = p_call_id) then
        raise exception 'asset call not found' using errcode = 'P0002';
      end if;
      select id into v_secret_id from vault.secrets where name = v_name;
      if v_secret_id is null then
        perform vault.create_secret(p_pair, v_name, 'Alcon sign-in payload awaiting its one delivery');
      else
        perform vault.update_secret(v_secret_id, p_pair);
      end if;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.stage_sign_in_payload(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.stage_sign_in_payload(uuid, text) to service_role';

  -- ── The take: delivered once, to the relay, then gone ────────────
  execute $ddl$
    create or replace function public.take_sign_in_payload(p_call_id uuid)
    returns text
    language plpgsql
    security definer
    set search_path = public, vault
    as $f$
    declare
      v_name text := 'sign-in:' || p_call_id::text;
      v_secret text;
    begin
      select ds.decrypted_secret into v_secret from vault.decrypted_secrets ds
       where ds.name = v_name;
      -- Taken once, present or not: the secret dies in this call, so
      -- a payload can never be delivered twice or linger past its
      -- call. (No row lock: the name is unique to one call, and the
      -- delete is the fence — a racing second take reads nothing
      -- once the first has deleted.)
      delete from vault.secrets where name = v_name;
      return v_secret;
    end
    $f$
  $ddl$;
  execute 'revoke all on function public.take_sign_in_payload(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.take_sign_in_payload(uuid) to service_role';
end
$$;
