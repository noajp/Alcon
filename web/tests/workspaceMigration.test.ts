import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The run_workspaces migration (coding capability PR1): the
// provisioning record is the audit — one live record per run, the
// caps on it, the egress it was bound under — and provision_asset
// is the one door through which a server-minted runner exists, so
// both are pinned here like the other guarded migrations. The
// migration is repo-only until the flush applies it; these tests
// read the shipped file.
const sql = readFileSync(
  new URL('../../supabase/migrations/20261219090000_run_workspaces.sql', import.meta.url).pathname,
  'utf8',
);

describe('20261219090000_run_workspaces', () => {
  it('is guarded on the tables and helpers it leans on', () => {
    expect(sql).toContain("to_regclass('public.agent_runs')");
    expect(sql).toContain("to_regclass('public.assets')");
    expect(sql).toContain("to_regclass('public.asset_events')");
    expect(sql).toContain("to_regclass('public.activity_spaces')");
    expect(sql).toContain("to_regprocedure('public.is_activity_space_member(uuid)')");
  });

  it('creates the record with the classes, statuses and cap/audit columns', () => {
    expect(sql).toContain('create table if not exists public.run_workspaces');
    expect(sql).toContain("class in ('managed', 'standing')");
    expect(sql).toContain("status in ('provisioning', 'ready', 'destroyed', 'failed', 'expired')");
    expect(sql).toContain("credential_free in ('server', 'self-reported')");
    for (const col of ['egress_declared', 'egress_effective', 'egress_enforced', 'caps', 'deadline', 'cost_usd', 'destroy_reason', 'ready_at', 'destroyed_at']) {
      expect(sql).toContain(col);
    }
  });

  it('allows at most one live record per run', () => {
    // Inside the guarded DO block the DDL runs through execute, so
    // the quotes are doubled in the file as shipped.
    expect(sql).toContain("create unique index if not exists run_workspaces_one_live_per_run on public.run_workspaces (run_id) where status in (''provisioning'', ''ready'')");
  });

  it('members read their Spaces\' records; nobody writes through the API', () => {
    expect(sql).toContain('alter table public.run_workspaces enable row level security');
    expect(sql).toContain("revoke all on table public.run_workspaces from public, anon, authenticated");
    expect(sql).toContain('grant select on public.run_workspaces to authenticated');
    expect(sql).toContain('public.is_activity_space_member(activity_space_id)');
  });

  it('provision_asset mints an already-claimed asset and is service-role only', () => {
    expect(sql).toContain('function public.provision_asset(');
    // The asset is born active and claimed by the run's starter,
    // with the provisioning on its event record.
    expect(sql).toContain("'ai_agent', 'active',");
    expect(sql).toContain('p_token_hash, p_token_prefix, p_claimed_by, now(), now()');
    expect(sql).toContain("'provisioned', 'Provisioned by the server as a per-run workspace");
    expect(sql).toContain('revoke all on function public.provision_asset(uuid, text, jsonb, text, text, uuid) from public, anon, authenticated');
    expect(sql).toContain('grant execute on function public.provision_asset(uuid, text, jsonb, text, text, uuid) to service_role');
  });
});
