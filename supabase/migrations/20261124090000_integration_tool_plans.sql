-- The tools one integration offers an agent are planned from its manifest
-- (and, for MCP, the server's tool list). Planning used to be redone on
-- every message and every run slice — a Vault read and an MCP initialize +
-- tools/list per connection, whether or not the turn ever called it. The
-- plan itself is pure output (names, descriptions, schemas, the manifest
-- commands and the server tools' metadata — never a secret, never a
-- session), so it is cached here, one row per integration, and revalidated
-- against a fingerprint of the manifest and the integration row:
--
--   integration_tool_plans
--     integration_id  the connection the plan belongs to
--     fingerprint     sha256 of the manifest's canonical form + the row's
--                     name / endpoint / kind / auth_type / updated_at — any
--                     meaningful change to the row (a manifest edit, a
--                     remembered approval rule, a rotated secret, a new
--                     endpoint) moves updated_at and so invalidates the plan
--     plan            PlannedIntegrationTool[] as jsonb
--     fetched_at      when the plan was made; an MCP plan is only trusted
--                     within a TTL (a server can change its tools without
--                     the row changing), a manifest plan has no TTL
--
-- Reads are open to the integration's Space members (the same rule as the
-- integrations row itself). There is no write policy: only the service
-- role — the Edge Functions that assemble tools — writes a plan.
-- Guarded for preview replay: skipped where integrations is absent.
do $$
begin
  if to_regclass('public.integrations') is null
     or to_regprocedure('public.is_activity_space_member(uuid)') is null then
    raise notice 'integration tool plans skipped: integrations or the membership helper not present';
    return;
  end if;

  create table if not exists public.integration_tool_plans (
    integration_id uuid primary key references public.integrations(id) on delete cascade,
    fingerprint text not null,
    plan jsonb not null,
    fetched_at timestamptz not null default now()
  );
  alter table public.integration_tool_plans enable row level security;
  grant select on public.integration_tool_plans to authenticated;
  drop policy if exists integration_tool_plans_select on public.integration_tool_plans;
  create policy integration_tool_plans_select on public.integration_tool_plans for select to authenticated
    using (exists (
      select 1 from public.integrations i
      where i.id = integration_tool_plans.integration_id
        and public.is_activity_space_member(i.activity_space_id)
    ));
end
$$;
