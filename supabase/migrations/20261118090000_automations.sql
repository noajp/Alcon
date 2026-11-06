-- Automations: a harness started by something other than a person's click.
--
--   automations        what starts a harness, where its work goes, and whose
--                      authority it runs with. kind:
--                        schedule   a 5-field cron in `timezone`
--                        webhook    a POST to the automations function with
--                                   the automation's token
--                      The run acts as `owner_id`, the person who set it up,
--                      so RLS and approvals are theirs. Members of the Space
--                      read; the owner or a Space owner writes.
--   automation_events  one row per firing: what came in, the Element and the
--                      run it made, and how it ended. Written by the
--                      automations function (service role); readable by
--                      members of the Space.
--
--   automation_tick_ok(token)  true when the token is the one the every-minute
--                      tick sends. The token is a Vault secret
--                      (automations_tick_token) made here once; only the
--                      service role may ask.
--
-- The every-minute tick (pg_cron → pg_net → the automations function) is set
-- up per environment, outside this file, because it needs the project's URL.
--
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.activity_spaces') is null or to_regclass('public.definitions') is null
     or to_regclass('public.objects') is null or to_regclass('public.elements') is null
     or to_regclass('public.agent_runs') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null
     or to_regprocedure('public.is_activity_space_owner(uuid)') is null then
    raise notice 'automations skipped: base tables or the Space helpers not present';
    return;
  end if;

  execute $ddl$
    create table if not exists public.automations (
      id uuid primary key default gen_random_uuid(),
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      name text not null check (char_length(btrim(name)) between 1 and 120),
      enabled boolean not null default true,
      definition_id uuid not null references public.definitions(id) on delete cascade,
      object_id uuid not null references public.objects(id) on delete cascade,
      kind text not null check (kind in ('schedule', 'webhook')),
      cron text check (cron is null or char_length(cron) <= 100),
      timezone text not null default 'Asia/Tokyo',
      token_hash text,
      owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
      next_run_at timestamptz,
      last_fired_at timestamptz,
      last_status text,
      last_error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      check (kind <> 'schedule' or cron is not null)
    )
  $ddl$;
  execute 'create index if not exists automations_due_idx on public.automations (next_run_at) where enabled and kind = ''schedule''';
  execute 'create index if not exists automations_space_idx on public.automations (activity_space_id)';
  execute 'alter table public.automations enable row level security';
  execute 'revoke all on table public.automations from public, anon';
  execute 'grant select, insert, update, delete on public.automations to authenticated';
  execute 'drop policy if exists automations_select on public.automations';
  execute 'create policy automations_select on public.automations for select to authenticated using (public.is_activity_space_member(activity_space_id))';
  execute 'drop policy if exists automations_insert on public.automations';
  execute 'create policy automations_insert on public.automations for insert to authenticated with check (public.is_activity_space_member(activity_space_id) and owner_id = auth.uid())';
  execute 'drop policy if exists automations_update on public.automations';
  execute 'create policy automations_update on public.automations for update to authenticated using (owner_id = auth.uid() or public.is_activity_space_owner(activity_space_id)) with check (public.is_activity_space_member(activity_space_id))';
  execute 'drop policy if exists automations_delete on public.automations';
  execute 'create policy automations_delete on public.automations for delete to authenticated using (owner_id = auth.uid() or public.is_activity_space_owner(activity_space_id))';

  execute $ddl$
    create table if not exists public.automation_events (
      id uuid primary key default gen_random_uuid(),
      automation_id uuid not null references public.automations(id) on delete cascade,
      activity_space_id uuid not null references public.activity_spaces(id) on delete cascade,
      source text not null check (source in ('schedule', 'webhook', 'manual')),
      payload jsonb,
      element_id uuid references public.elements(id) on delete set null,
      run_id uuid references public.agent_runs(id) on delete set null,
      status text not null default 'received' check (status in ('received', 'started', 'skipped', 'failed')),
      error text,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists automation_events_automation_idx on public.automation_events (automation_id, created_at desc)';
  execute 'alter table public.automation_events enable row level security';
  execute 'revoke all on table public.automation_events from public, anon, authenticated';
  execute 'grant select on public.automation_events to authenticated';
  execute 'drop policy if exists automation_events_select on public.automation_events';
  execute 'create policy automation_events_select on public.automation_events for select to authenticated using (public.is_activity_space_member(activity_space_id))';

  if to_regclass('vault.secrets') is not null and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'vault' and p.proname = 'create_secret') then
    if not exists (select 1 from vault.secrets where name = 'automations_tick_token') then
      perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'automations_tick_token', 'The every-minute automations tick sends this.');
    end if;
    execute $fn$
      create or replace function public.automation_tick_ok(p_token text) returns boolean
      language sql stable security definer set search_path = '' as $body$
        select exists (select 1 from vault.decrypted_secrets where name = 'automations_tick_token' and decrypted_secret = p_token)
      $body$
    $fn$;
    execute 'revoke all on function public.automation_tick_ok(text) from public, anon, authenticated';
    execute 'grant execute on function public.automation_tick_ok(text) to service_role';
  else
    raise notice 'automations: vault not present, no tick token';
  end if;
end
$$;
