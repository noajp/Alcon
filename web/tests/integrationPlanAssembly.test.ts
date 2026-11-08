import { describe, expect, it } from 'vitest';

// Assembly through the plan cache (_shared/integrationTools.ts +
// integrationPlans.ts): a vouched-for plan assembles a Space's tools with
// no Vault read and no MCP session, the binding resolves lazily on first
// use and memoizes, a failed refetch falls back to the stale plan, and
// the approval facts are gathered without ever touching the binding.

type ToolCall = { id: string; name: string; input: Record<string, unknown> };
// deno-lint-ignore no-explicit-any
type Any = any;

const it8n = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname) as unknown as {
  buildSpaceIntegrationTools: (args: { userDb: Any; admin: Any; spaceId: string; supabaseUrl: string | null }) => Promise<{
    defs: { name: string }[];
    tools: Map<string, Record<string, unknown>>;
    usable: { name: string; kind: string; tools: number }[];
    down: { name: string; reason: string }[];
  }>;
  bindingOf: (it: Record<string, unknown>) => Promise<{ secret: string | null; session: unknown }>;
  lazyBinding: (admin: Any, row: Record<string, unknown>) => () => Promise<{ secret: string | null; session: unknown }>;
  integrationApprovalFacts: (it: Record<string, unknown> | undefined, call: ToolCall, isWrite: boolean) => Record<string, unknown>;
};
const plans = await import(new URL('../../supabase/functions/_shared/integrationPlans.ts', import.meta.url).pathname) as unknown as {
  planFingerprint: (row: Record<string, unknown>) => Promise<string>;
};
const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname) as unknown as {
  parseManifest: (raw: unknown) => { manifest: unknown };
};
const policy = await import(new URL('../../supabase/functions/_shared/approvalPolicy.ts', import.meta.url).pathname) as unknown as {
  needsApprovalFor: (facts: Record<string, unknown>) => boolean;
};

const MCP_MANIFEST_RAW = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'search', action: 'repos.search', effect: 'read', mcp: 'search_repositories' },
    { name: 'merge', action: 'pulls.merge', effect: 'write', mcp: 'merge_pull_request' },
  ],
};
const API_MANIFEST_RAW = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'create_item', action: 'items.create', effect: 'write', input: { title: { type: 'string' } }, required: ['title'], http: { method: 'POST', path: '/items', body: ['title'] } },
  ],
};

const UPDATED = '2026-11-08T00:00:00.000Z';
const mcpRow = {
  id: '11111111-1111-1111-1111-111111111111', preset: null, kind: 'mcp', name: 'GitHub', description: null,
  endpoint: 'https://api.githubcopilot.com/mcp', auth_type: 'bearer', auth_header: null,
  delegation: 'approve_each', enabled: true, manifest: MCP_MANIFEST_RAW, guide: null, updated_at: UPDATED,
};
const apiRow = {
  id: '22222222-2222-2222-2222-222222222222', preset: null, kind: 'http', name: 'Items API', description: null,
  endpoint: 'https://api.example.com', auth_type: 'bearer', auth_header: null,
  delegation: 'approve_each', enabled: true, manifest: API_MANIFEST_RAW, guide: null, updated_at: UPDATED,
};

/** A chainable fake for the one select buildSpaceIntegrationTools makes. */
function userDbWith(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order']) chain[m] = () => chain;
  chain.then = (resolve: (v: { data: Record<string, unknown>[] }) => void) => resolve({ data: rows });
  return { from: () => chain };
}

/** A fake service-role client: plan reads/writes plus a counted Vault RPC. */
function adminWith(planRows: Record<string, unknown>[], opts: { rpcError?: boolean } = {}) {
  const state = { rpcCalls: 0, upserts: [] as Record<string, unknown>[] };
  const plansChain: Record<string, unknown> = {};
  plansChain.select = () => plansChain;
  plansChain.in = () => Promise.resolve({ data: planRows, error: null });
  plansChain.upsert = (values: Record<string, unknown>) => { state.upserts.push(values); return Promise.resolve({ error: null }); };
  return {
    state,
    client: {
      from: () => plansChain,
      rpc: () => {
        state.rpcCalls++;
        return opts.rpcError ? Promise.reject(new Error('vault unavailable')) : Promise.resolve({ data: 'the-secret' });
      },
    },
  };
}

const mcpPlan = async () => {
  const manifest = cm.parseManifest(MCP_MANIFEST_RAW).manifest as { commands: unknown[] };
  void manifest;
  return [
    { name: 'github_1111__search', description: '[GitHub] Search', input_schema: { type: 'object' }, command: (cm.parseManifest(MCP_MANIFEST_RAW).manifest as { commands: Record<string, unknown>[] }).commands[0], remote: { name: 'search_repositories', description: 'Search repos', inputSchema: { type: 'object' }, readOnly: true } },
    { name: 'github_1111__merge', description: '[GitHub] Merge', input_schema: { type: 'object' }, command: (cm.parseManifest(MCP_MANIFEST_RAW).manifest as { commands: Record<string, unknown>[] }).commands[1], remote: { name: 'merge_pull_request', description: 'Merge a PR', inputSchema: { type: 'object' }, readOnly: false } },
  ];
};

describe('buildSpaceIntegrationTools through the plan cache', () => {
  it('assembles an MCP connection from a fresh cached plan with no Vault read at all', async () => {
    const fingerprint = await plans.planFingerprint(mcpRow);
    const stored = [{ integration_id: mcpRow.id, fingerprint, plan: await mcpPlan(), fetched_at: new Date().toISOString() }];
    const admin = adminWith(stored);
    const out = await it8n.buildSpaceIntegrationTools({ userDb: userDbWith([mcpRow]) as Any, admin: admin.client as Any, spaceId: 's1', supabaseUrl: null });
    expect(out.usable).toEqual([{ name: 'GitHub', kind: 'MCP', delegation: 'approve_each', tools: 2 }]);
    expect(out.down).toEqual([]);
    expect(out.defs.map((d) => d.name)).toEqual(['github_1111__search', 'github_1111__merge']);
    expect(admin.state.rpcCalls).toBe(0);
    // The tools carry a lazy binding, not a secret.
    const tool = out.tools.get('github_1111__merge')!;
    expect(tool.secret).toBeUndefined();
    expect(typeof tool.bind).toBe('function');
  });

  it('falls back to the stale plan when the refetch fails, instead of downing the connection', async () => {
    // Fingerprint matches but the plan is older than the MCP TTL, so a
    // refetch is attempted — and the Vault read fails.
    const fingerprint = await plans.planFingerprint(mcpRow);
    const stored = [{ integration_id: mcpRow.id, fingerprint, plan: await mcpPlan(), fetched_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() }];
    const admin = adminWith(stored, { rpcError: true });
    const out = await it8n.buildSpaceIntegrationTools({ userDb: userDbWith([mcpRow]) as Any, admin: admin.client as Any, spaceId: 's1', supabaseUrl: null });
    expect(out.down).toEqual([]);
    expect(out.usable).toEqual([{ name: 'GitHub', kind: 'MCP', delegation: 'approve_each', tools: 2 }]);
    expect(out.defs).toHaveLength(2);
  });

  it('plans an API manifest once and caches it; the next assembly reuses the plan untouched', async () => {
    const admin = adminWith([]);
    const first = await it8n.buildSpaceIntegrationTools({ userDb: userDbWith([apiRow]) as Any, admin: admin.client as Any, spaceId: 's1', supabaseUrl: null });
    expect(first.usable).toEqual([{ name: 'Items API', kind: 'API', delegation: 'approve_each', tools: 1 }]);
    expect(admin.state.rpcCalls).toBe(0);
    expect(admin.state.upserts).toHaveLength(1);
    const storedPlan = admin.state.upserts[0].plan as { name: string }[];
    expect(storedPlan.map((p) => p.name)).toEqual(first.defs.map((d) => d.name));
    // A plan never carries a secret or a session.
    expect(JSON.stringify(admin.state.upserts[0])).not.toContain('the-secret');

    const fingerprint = await plans.planFingerprint(apiRow);
    const admin2 = adminWith([{ integration_id: apiRow.id, fingerprint, plan: storedPlan, fetched_at: new Date().toISOString() }]);
    const second = await it8n.buildSpaceIntegrationTools({ userDb: userDbWith([apiRow]) as Any, admin: admin2.client as Any, spaceId: 's1', supabaseUrl: null });
    expect(second.defs.map((d) => d.name)).toEqual(first.defs.map((d) => d.name));
    expect(admin2.state.upserts).toHaveLength(0);
  });
});

describe('lazy binding', () => {
  it('resolves the credential at first use and memoizes it for the request', async () => {
    const admin = adminWith([]);
    const bind = it8n.lazyBinding(admin.client as Any, apiRow);
    const tool: Record<string, unknown> = { integration: apiRow, remote: null, bind };
    expect(admin.state.rpcCalls).toBe(0);
    const first = await it8n.bindingOf(tool);
    expect(first).toEqual({ secret: 'the-secret', session: null });
    const second = await it8n.bindingOf(tool);
    expect(second).toBe(first);
    expect(admin.state.rpcCalls).toBe(1);
  });

  it('an eagerly bound tool keeps its own secret and session', async () => {
    const session = { fake: true };
    const bound = await it8n.bindingOf({ integration: apiRow, remote: null, secret: 'held', session });
    expect(bound).toEqual({ secret: 'held', session });
  });

  it('approval facts are gathered from a lazily bound tool without resolving its binding', async () => {
    const fingerprint = await plans.planFingerprint(apiRow);
    const storedPlan = [{
      name: 'items_2222__create_item', description: '[Items API] Create', input_schema: { type: 'object' },
      command: (cm.parseManifest(API_MANIFEST_RAW).manifest as { commands: Record<string, unknown>[] }).commands[0], remote: null,
    }];
    const admin = adminWith([{ integration_id: apiRow.id, fingerprint, plan: storedPlan, fetched_at: new Date().toISOString() }]);
    const out = await it8n.buildSpaceIntegrationTools({ userDb: userDbWith([apiRow]) as Any, admin: admin.client as Any, spaceId: 's1', supabaseUrl: null });
    const tool = out.tools.get('items_2222__create_item')!;
    const facts = it8n.integrationApprovalFacts(tool, { id: 'c1', name: 'items_2222__create_item', input: { title: 't' } }, true);
    // A write under the ask default asks — decided from the manifest alone.
    expect(policy.needsApprovalFor(facts)).toBe(true);
    expect(admin.state.rpcCalls).toBe(0);
    expect(tool.binding).toBeUndefined();
  });
});
