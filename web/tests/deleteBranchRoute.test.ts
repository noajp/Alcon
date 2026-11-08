import { afterEach, describe, expect, it, vi } from 'vitest';

// delete_branch, route R1: the GitHub preset's MCP session asks the
// hosted server for the tool surface that includes branch deletion
// (X-MCP-Toolsets / X-MCP-Tools, vetted endpoint only). Once the tool
// is listed, the manifest rebuild classifies it with no new code: a
// write, permission ask by default, critical class delete — which
// always asks in Auto mode. The live spike against the real server
// (connection test on a dev Space after deploy) remains: these tests
// pin everything this side of the wire.

const client = await import(new URL('../../supabase/functions/_shared/integrationClient.ts', import.meta.url).pathname) as unknown as {
  mcpPresetHeaders: (row: { preset?: string | null; endpoint: string }) => Record<string, string>;
  McpSession: new (row: unknown, secret: string | null) => {
    initialize(): Promise<void>;
    listTools(): Promise<{ name: string; readOnly: boolean }[]>;
  };
};
const manifest = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname) as unknown as {
  manifestFromTools: (tools: { name: string; description?: string; readOnly: boolean }[], existing: unknown) => {
    defaults: { read: string; write: string };
    commands: Record<string, unknown>[];
  };
  criticalClassOf: (cmd: Record<string, unknown>) => string | null;
};

const GH_ROW = {
  id: 'i1', preset: 'github', kind: 'mcp', name: 'GitHub', description: null,
  endpoint: 'https://api.githubcopilot.com/mcp/', auth_type: 'oauth', auth_header: null, delegation: 'approve_each',
};

describe('mcpPresetHeaders — vetted endpoints only', () => {
  it('the github preset at its catalog endpoint asks for delete_branch', () => {
    const h = client.mcpPresetHeaders(GH_ROW);
    expect(h['X-MCP-Tools']).toBe('delete_branch');
    expect(h['X-MCP-Toolsets']).toContain('repos');
  });

  it('the same preset name at any other endpoint gets nothing', () => {
    expect(client.mcpPresetHeaders({ preset: 'github', endpoint: 'https://mcp.example.com/mcp' })).toEqual({});
    expect(client.mcpPresetHeaders({ preset: 'github', endpoint: 'https://api.githubcopilot.com/mcp/evil' })).toEqual({});
  });

  it('other presets and preset-less connections get nothing', () => {
    expect(client.mcpPresetHeaders({ preset: 'linear', endpoint: 'https://mcp.linear.app/mcp' })).toEqual({});
    expect(client.mcpPresetHeaders({ preset: null, endpoint: 'https://api.githubcopilot.com/mcp/' })).toEqual({});
  });
});

describe('McpSession against a server that honours the headers', () => {
  const seen: { method: string; headers: Record<string, string> }[] = [];

  function fakeGitHubServer() {
    return async (_url: unknown, init: { body: string; headers: Record<string, string> }) => {
      const req = JSON.parse(init.body) as { id?: number; method: string };
      seen.push({ method: req.method, headers: init.headers });
      const wantsBranchTools = (init.headers['X-MCP-Tools'] ?? '').includes('delete_branch');
      const result = req.method === 'initialize'
        ? { protocolVersion: '2025-06-18' }
        : req.method === 'tools/list'
          ? {
            tools: [
              { name: 'list_branches', description: 'List branches', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
              ...(wantsBranchTools
                ? [{ name: 'delete_branch', description: 'Delete a branch', inputSchema: { type: 'object', properties: {} }, annotations: {} }]
                : []),
            ],
          }
          : {};
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id ?? 0, result }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
  }

  afterEach(() => { vi.unstubAllGlobals(); seen.length = 0; });

  it('the session sends the toolset headers, and delete_branch lists as a write', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeGitHubServer()));
    const session = new client.McpSession(GH_ROW, 'token');
    await session.initialize();
    const tools = await session.listTools();
    const listCall = seen.find((s) => s.method === 'tools/list');
    expect(listCall?.headers['X-MCP-Tools']).toBe('delete_branch');
    const del = tools.find((t) => t.name === 'delete_branch');
    expect(del).toBeDefined();
    // Its name says it writes, so no readOnlyHint could make it a read.
    expect(del!.readOnly).toBe(false);
    expect(tools.find((t) => t.name === 'list_branches')!.readOnly).toBe(true);
  });

  it('the manifest rebuild classifies the listed tool: write, ask, critical delete', async () => {
    vi.stubGlobal('fetch', vi.fn(fakeGitHubServer()));
    const session = new client.McpSession(GH_ROW, 'token');
    await session.initialize();
    const tools = await session.listTools();
    const m = manifest.manifestFromTools(tools, null);
    expect(m.defaults).toEqual({ read: 'allow', write: 'ask' });
    const cmd = m.commands.find((c) => c.name === 'delete_branch');
    expect(cmd).toBeDefined();
    expect(cmd!.effect).toBe('write');
    expect(cmd!.mcp).toBe('delete_branch');
    expect(cmd!.permission).toBeUndefined(); // the write default — ask — applies
    expect(manifest.criticalClassOf(cmd as never)).toBe('delete');
  });
});
