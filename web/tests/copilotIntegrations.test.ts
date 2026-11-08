import { describe, expect, it } from 'vitest';

// The Copilot's integration tools come from the same shared code as a run's
// (_shared/integrationTools.ts): a manifest plans the tools, the approval
// facts are gathered one way, and the approval card is built from the same
// display contract. These tests pin the pure parts of that sharing.

type Manifest = { commands: { name: string }[] };
type ToolCall = { id: string; name: string; input: Record<string, unknown> };
type IntegrationToolLike = Record<string, unknown>;

const it8n = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname) as unknown as {
  planManifestTools: (row: { name: string; id: string }, manifest: Manifest | null, remoteTools: { name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[] | null, taken: Map<string, unknown>) => { name: string; description: string; input_schema: Record<string, unknown>; command: { name: string }; remote: { name: string } | null }[];
  integrationApprovalFacts: (it: IntegrationToolLike | undefined, call: ToolCall, isWrite: boolean) => Record<string, unknown>;
  approvalDisplayForCall: (tools: Map<string, IntegrationToolLike>, call: ToolCall) => { id: string; integration: string; operation: string; destination: string; detail: string | null; effect: string; critical: string | null; rememberable: boolean };
  integrationPromptSection: (t: { usable: { name: string; kind: string; delegation: string; tools: number }[]; down: { name: string; reason: string }[] }) => string;
  integrationPrefix: (name: string, id: string) => string;
  uniqueToolName: (raw: string, taken: Map<string, unknown>) => string;
};
const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname) as unknown as {
  parseManifest: (raw: unknown) => { manifest: Manifest; errors: string[] };
};
const policy = await import(new URL('../../supabase/functions/_shared/approvalPolicy.ts', import.meta.url).pathname) as unknown as {
  needsApprovalFor: (facts: Record<string, unknown>) => boolean;
};

const ROW = { name: 'GitHub', id: '123e4567-e89b-12d3-a456-426614174000' };

const API_MANIFEST = cm.parseManifest({
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'list_items', action: 'items.list', effect: 'read', description: 'List items', http: { method: 'GET', path: '/items' } },
    { name: 'create_item', action: 'items.create', effect: 'write', input: { title: { type: 'string' } }, required: ['title'], http: { method: 'POST', path: '/items', body: ['title'] } },
    { name: 'wipe', action: 'items.wipe', effect: 'write', permission: 'allow', http: { method: 'DELETE', path: '/items' } },
    { name: 'blocked', action: 'items.blocked', effect: 'write', permission: 'deny', http: { method: 'POST', path: '/blocked' } },
    { name: 'nowhere', action: 'items.nowhere', effect: 'read' },
  ],
}).manifest;

const MCP_MANIFEST = cm.parseManifest({
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'search', action: 'repos.search', effect: 'read', mcp: 'search_repositories' },
    { name: 'merge', action: 'pulls.merge', effect: 'write', mcp: 'merge_pull_request' },
  ],
}).manifest;

describe('planManifestTools', () => {
  it('plans an API manifest\'s declared http commands, with the manifest\'s schemas', () => {
    const planned = it8n.planManifestTools(ROW, API_MANIFEST, null, new Map());
    // `nowhere` declares no http mapping, so it is not an API tool; `blocked`
    // is denied by its manifest, so it is never offered at all.
    expect(planned.map((p) => p.command.name)).toEqual(['list_items', 'create_item', 'wipe']);
    expect(planned[0].name).toBe(`${it8n.integrationPrefix('GitHub', ROW.id)}__list_items`);
    expect(planned[0].description).toContain('（読み取り）');
    expect(planned[1].description).toContain('（書き込み）');
    expect(planned[1].input_schema).toEqual({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false });
    expect(planned.every((p) => p.remote === null)).toBe(true);
  });

  it('plans only the MCP tools the manifest declares, under their commands', () => {
    const remote = [
      { name: 'search_repositories', description: 'Search repos', inputSchema: { type: 'object' }, readOnly: true },
      { name: 'merge_pull_request', description: 'Merge a PR', inputSchema: { type: 'object' }, readOnly: false },
      { name: 'delete_repository', description: 'Delete a repo', inputSchema: { type: 'object' }, readOnly: false },
    ];
    const planned = it8n.planManifestTools(ROW, MCP_MANIFEST, remote, new Map());
    expect(planned.map((p) => p.command.name)).toEqual(['search', 'merge']);
    expect(planned[0].remote?.name).toBe('search_repositories');
    expect(planned[1].name).toContain('__merge');
    expect(planned[0].input_schema).toEqual({ type: 'object' });
  });

  it('plans nothing without a manifest — an untested connection stays closed', () => {
    expect(it8n.planManifestTools(ROW, null, [{ name: 'x', description: '', inputSchema: {}, readOnly: true }], new Map())).toEqual([]);
    expect(it8n.planManifestTools(ROW, null, null, new Map())).toEqual([]);
  });

  it('never reuses a taken tool name', () => {
    const taken = new Map<string, unknown>();
    const first = it8n.planManifestTools(ROW, API_MANIFEST, null, taken);
    const second = it8n.planManifestTools(ROW, API_MANIFEST, null, taken);
    expect(new Set([...first, ...second].map((p) => p.name)).size).toBe(first.length + second.length);
    expect(it8n.uniqueToolName('a'.repeat(80), new Map()).length).toBeLessThanOrEqual(64);
  });
});

describe('integrationApprovalFacts → needsApprovalFor (the run\'s policy)', () => {
  const toolFor = (commandName: string, delegation = 'ask_each_time') => {
    const command = (API_MANIFEST.commands as unknown as Record<string, unknown>[]).find((c) => c.name === commandName) as Record<string, unknown>;
    return { command, manifest: API_MANIFEST, integration: { delegation }, remote: null } as IntegrationToolLike;
  };
  const asks = (it: IntegrationToolLike | undefined, name: string, input: Record<string, unknown> = {}) =>
    policy.needsApprovalFor(it8n.integrationApprovalFacts(it, { id: 'c1', name, input }, true));

  it('a read under the defaults runs without asking', () => {
    expect(asks(toolFor('list_items'), 'x__list_items')).toBe(false);
  });

  it('a write under the ask default asks; full delegation lifts the ask', () => {
    expect(asks(toolFor('create_item'), 'x__create_item', { title: 't' })).toBe(true);
    expect(asks(toolFor('create_item', 'full_delegation'), 'x__create_item', { title: 't' })).toBe(false);
  });

  it('a critical command asks even under full delegation, whatever its permission says', () => {
    expect(asks(toolFor('wipe', 'full_delegation'), 'x__wipe')).toBe(true);
  });

  it('a denied command does not ask (the executor refuses it instead)', () => {
    expect(asks(toolFor('blocked'), 'x__blocked')).toBe(false);
  });

  it('the raw http_request asks for any non-read method, under every delegation', () => {
    const raw = { integration: { delegation: 'full_delegation' }, remote: null } as IntegrationToolLike;
    expect(asks(raw, 'x__http_request', { method: 'POST', path: '/a' })).toBe(true);
    expect(asks(raw, 'x__http_request', { method: 'GET', path: '/a' })).toBe(false);
  });
});

describe('approvalDisplayForCall', () => {
  it('shows a manifest HTTP call with its resolved request line, and a critical call as unrememberable', () => {
    const command = (API_MANIFEST.commands as unknown as Record<string, unknown>[]).find((c) => c.name === 'create_item');
    const tools = new Map<string, IntegrationToolLike>([
      ['gh__create_item', { command, manifest: API_MANIFEST, integration: { name: 'GitHub', endpoint: 'https://api.github.com' }, remote: null }],
    ]);
    const d = it8n.approvalDisplayForCall(tools, { id: 'c1', name: 'gh__create_item', input: { title: 'Hello' } });
    expect(d).toMatchObject({ id: 'c1', integration: 'GitHub', operation: 'items.create', destination: 'https://api.github.com', detail: 'POST /items', effect: 'write', critical: null, rememberable: true });

    const wipe = (API_MANIFEST.commands as unknown as Record<string, unknown>[]).find((c) => c.name === 'wipe');
    tools.set('gh__wipe', { command: wipe, manifest: API_MANIFEST, integration: { name: 'GitHub', endpoint: 'https://api.github.com' }, remote: null });
    const dw = it8n.approvalDisplayForCall(tools, { id: 'c2', name: 'gh__wipe', input: {} });
    expect(dw.critical).toBe('delete');
    expect(dw.rememberable).toBe(false);
  });

  it('falls back to the name\'s parts for a tool the map no longer holds', () => {
    const d = it8n.approvalDisplayForCall(new Map(), { id: 'c9', name: 'linear__create_issue', input: {} });
    expect(d).toMatchObject({ integration: 'linear', operation: 'create_issue', effect: 'write', rememberable: false });
  });
});

describe('integrationPromptSection', () => {
  it('names the connected integrations and how their writes are held', () => {
    const s = it8n.integrationPromptSection({ usable: [{ name: 'GitHub', kind: 'MCP', delegation: 'ask_each_time', tools: 12 }], down: [{ name: 'Old API', reason: '接続テストが済んでいない' }] });
    expect(s).toContain('GitHub');
    expect(s).toContain('承認カード');
    expect(s).toContain('Old API: 接続テストが済んでいない');
  });

  it('with none connected, points at Settings instead of claiming external services are unsupported', () => {
    const s = it8n.integrationPromptSection({ usable: [], down: [] });
    expect(s).toContain('Settings › Customize');
    expect(s).toContain('「外部サービスには対応していない」とは答えず');
  });
});
