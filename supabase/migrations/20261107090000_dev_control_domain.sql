-- The dev loop reads its Domain from the database.
--
--   dev_control.domain_id  the Domain the dev loop works in. The ops scripts
--                          (board-listen, stall-check, loop-report) read it
--                          here instead of carrying an id of their own.
do $$
begin
  if to_regclass('public.dev_control') is not null and to_regclass('public.domains') is not null then
    execute 'alter table public.dev_control add column if not exists domain_id uuid references public.domains(id) on delete set null';
  else
    raise notice 'dev_control_domain: dev_control or domains not present';
  end if;
end
$$;
