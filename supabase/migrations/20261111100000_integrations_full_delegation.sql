-- Agents act in a connected service without asking each time: every
-- integration is fully delegated, and a new one starts that way. Whether
-- agents may use a service at all is its on/off.
do $$
begin
  if to_regclass('public.integrations') is null then
    raise notice 'full delegation skipped: integrations not present'; return;
  end if;
  execute 'alter table public.integrations alter column delegation set default ''full_delegation''';
  execute 'update public.integrations set delegation = ''full_delegation'' where delegation <> ''full_delegation''';
end $$;
