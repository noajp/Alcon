-- Connector manifests: what an integration may be asked to do, declared
-- instead of left open. An API or MCP integration may carry
--
--   manifest   the policy the engine enforces: the commands it offers (each a
--              canonical action, read or write, allow / ask / deny, and for an
--              API how it maps onto a request under the integration's base
--              URL). With a manifest only declared commands reach the agent.
--   guide      how to use it, for the agent (not enforced).
--
-- Read by run-agent (supabase/functions/_shared/connectorManifest.ts).
-- Guarded for preview replay (the base schema lives outside this folder).

do $$
begin
  if to_regclass('public.integrations') is null then
    raise notice 'integration manifest skipped: integrations not present'; return;
  end if;
  execute 'alter table public.integrations add column if not exists manifest jsonb';
  execute 'alter table public.integrations add column if not exists guide text';
  -- Writable by whoever may write the integration's other settings (RLS decides which rows).
  execute 'grant insert (manifest, guide), update (manifest, guide) on public.integrations to authenticated';
end $$;
