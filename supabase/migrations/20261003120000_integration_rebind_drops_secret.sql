-- An integration's credential belongs to the destination it was entered
-- for. Pointing the integration somewhere else (endpoint), or changing how
-- the credential is sent (auth_type / auth_header), drops the stored
-- credential and the last test result: otherwise an owner of a shared Space
-- could repoint another owner's integration at a server they control and
-- have the credential sent there by a connection test or an agent run.
-- The owner re-enters the credential for the new destination.
-- Guarded for preview replay.
do $$
begin
  if to_regclass('public.integrations') is null
     or not exists (select 1 from pg_namespace where nspname = 'vault') then
    raise notice 'integration rebind rule skipped: integrations or vault not present';
    return;
  end if;

  create or replace function public.integrations_rebind_drops_secret()
  returns trigger language plpgsql security definer set search_path = public, vault as $f$
  begin
    if new.endpoint is distinct from old.endpoint
       or new.auth_type is distinct from old.auth_type
       or new.auth_header is distinct from old.auth_header then
      delete from vault.secrets where name = 'integration:' || old.id::text;
      new.secret_id := null;
      new.last_test := null;
    end if;
    return new;
  end
  $f$;
  drop trigger if exists trg_integrations_rebind_drops_secret on public.integrations;
  create trigger trg_integrations_rebind_drops_secret before update on public.integrations
    for each row execute function public.integrations_rebind_drops_secret();
end
$$;
