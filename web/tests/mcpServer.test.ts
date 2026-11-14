import { describe, expect, it } from 'vitest';

const protocol = await import(new URL('../../supabase/functions/clayware-mcp/protocol.ts', import.meta.url).pathname);
const { mcpTools, mcpHost } = await import(new URL('../../supabase/functions/clayware-mcp/tools.ts', import.meta.url).pathname);
const board = await import(new URL('../../supabase/functions/_shared/boardTools.ts', import.meta.url).pathname);

const { handleBody, clientLabel, negotiateVersion, SUPPORTED_PROTOCOL_VERSIONS, RPC } = protocol;
const { displayIdCandidates, describePatch, resolveElementId, runBoardTool, errorMessage } = board;

const UUID = '93fb2fb0-a7a1-434e-9211-af4db709a247';
const OTHER = '85c79ab0-fb76-4bf3-8a75-c5635880cb4f';

type Row = Record<string, unknown>;

/**
 * A just-big-enough stand-in for the Supabase query builder: filters by
 * eq / in / ilike over in-memory rows (what RLS lets the caller see) and
 * records every insert / update so a test can read what would be written.
 */
function fakeDb(tables: Record<string, Row[]>) {
  const writes: { table: string; op: 'insert' | 'update'; row: Row }[] = [];
  function from(table: string) {
    const rows = () => tables[table] ?? [];
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    let pending: { op: 'insert' | 'update'; row: Row } | null = null;
    const run = () => {
      if (pending?.op === 'insert') {
        const row = { id: `new-${writes.length}`, ...pending.row };
        writes.push({ table, op: 'insert', row });
        (tables[table] ??= []).push(row);
        return [row];
      }
      const hit = rows().filter(r => filters.every(f => f(r))).slice(0, limit);
      if (pending?.op === 'update') {
        for (const r of hit) Object.assign(r, pending.row);
        writes.push({ table, op: 'update', row: pending.row });
      }
      return hit;
    };
    const q = {
      select: () => q,
      order: () => q,
      insert: (row: Row) => { pending = { op: 'insert', row }; return q; },
      update: (row: Row) => { pending = { op: 'update', row }; return q; },
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (r[k] ?? null) === v); return q; },
      in: (k: string, vs: unknown[]) => { filters.push(r => vs.includes(r[k])); return q; },
      ilike: (k: string, pattern: string) => {
        const re = new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`, 'i');
        filters.push(r => re.test(String(r[k] ?? '')));
        return q;
      },
      limit: (n: number) => { limit = n; return q; },
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      single: async () => {
        const [row] = run();
        return row ? { data: row, error: null } : { data: null, error: { message: 'no row' } };
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: run(), error: null }),
    };
    return q;
  }
  return { db: { from } as never, writes };
}

const host = (calls: string[] = []) => ({
  tools: mcpTools(),
  call: async (name: string) => { calls.push(name); return { ok: true as const, data: { name } }; },
});

describe('MCP protocol', () => {
  it('answers initialize with a supported version and the tools capability', async () => {
    const res = await handleBody(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }), host());
    expect(res.status).toBe(200);
    const result = (res.body as { result: Record<string, unknown> }).result;
    expect(result.protocolVersion).toBe('2025-03-26');
    expect(result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(negotiateVersion('1999-01-01')).toBe(SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  it('acknowledges notifications with 202 and no body', async () => {
    expect(await handleBody(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), host())).toEqual({ status: 202 });
  });

  it('rejects malformed JSON and unknown methods with JSON-RPC errors', async () => {
    const parse = await handleBody('{nope', host());
    expect(parse.status).toBe(400);
    expect((parse.body as { error: { code: number } }).error.code).toBe(RPC.PARSE_ERROR);
    const unknown = await handleBody(JSON.stringify({ jsonrpc: '2.0', id: 'x', method: 'resources/list' }), host());
    expect((unknown.body as { error: { code: number } }).error.code).toBe(RPC.METHOD_NOT_FOUND);
  });

  it('acknowledges a client response with 202 and checks the protocol header', async () => {
    expect(await handleBody(JSON.stringify({ jsonrpc: '2.0', id: 9, result: {} }), host())).toEqual({ status: 202 });
    expect(protocol.acceptsProtocolHeader(null)).toBe(true);
    expect(protocol.acceptsProtocolHeader('2025-06-18')).toBe(true);
    expect(protocol.acceptsProtocolHeader('1.0')).toBe(false);
  });

  it('answers each request in a batch and skips its notifications', async () => {
    const res = await handleBody(JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]), host());
    expect(res.body).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
  });

  it('routes a listed tool and refuses one the server does not offer', async () => {
    const calls: string[] = [];
    const ok = await handleBody(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'getElement', arguments: { id: 'x' } } }), host(calls));
    expect((ok.body as { result: { isError: boolean } }).result.isError).toBe(false);
    // start_promotion exists in the catalog but is not an MCP tool.
    const refused = await handleBody(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'start_promotion', arguments: { id: 'x' } } }), host(calls));
    expect((refused.body as { error: { code: number } }).error.code).toBe(RPC.INVALID_PARAMS);
    expect(calls).toEqual(['getElement']);
  });

  it('reports a failed tool as a tool error, not a protocol error', () => {
    expect(protocol.toCallResult({ ok: false, error: 'Element not found' })).toEqual({
      content: [{ type: 'text', text: 'Error: Element not found' }],
      isError: true,
    });
  });
});

describe('MCP tool surface', () => {
  it('offers what the AI panel reaches, plus Tables and the lease and report tools', () => {
    const names = mcpTools().map((t: { name: string }) => t.name);
    for (const n of ['listElements', 'deleteElement', 'createObject', 'bulkUpdateElements', 'updateInitiative', 'writeFile', 'readHarness', 'remember', 'tableData', 'widgetBoard', 'claimElement', 'reportOutcome']) {
      expect(names).toContain(n);
    }
    expect(new Set(names).size).toBe(names.length);
    // Handing work to Clayware's own model is not offered.
    expect(names).not.toContain('start_promotion');
  });

  it('lists reads first and marks deletes and overwrites destructive', () => {
    const tools = mcpTools();
    const firstWrite = tools.findIndex((t: { annotations: { readOnlyHint: boolean } }) => !t.annotations.readOnlyHint);
    expect(tools.slice(firstWrite).every((t: { annotations: { readOnlyHint: boolean } }) => !t.annotations.readOnlyHint)).toBe(true);
    type Tool = { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } };
    const by = new Map<string, Tool>(tools.map((t: Tool) => [t.name, t]));
    for (const n of ['deleteElement', 'bulkDeleteElements', 'deleteInitiative', 'updateElement', 'tableData']) expect(by.get(n)!.annotations.destructiveHint, n).toBe(true);
    for (const n of ['listElements', 'getInitiative', 'readFile']) expect(by.get(n)!.annotations.readOnlyHint, n).toBe(true);
    for (const n of ['createElement', 'addElementComment', 'claimElement']) expect(by.get(n)!.annotations.destructiveHint, n).toBe(false);
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
  });
});

describe('clientLabel', () => {
  const url = (q = '') => new URL(`https://x.supabase.co/functions/v1/clayware-mcp${q}`);
  it('recognises clients from the User-Agent', () => {
    expect(clientLabel(url(), 'claude-code/2.1.0')).toBe('Claude Code (MCP)');
    expect(clientLabel(url(), 'Claude-User')).toBe('Claude (MCP)');
    expect(clientLabel(url(), 'openai-mcp/1.0.0')).toBe('ChatGPT (MCP)');
    expect(clientLabel(url(), null)).toBe('AI (MCP)');
  });
  it('prefers ?client= and strips anything that is not a name', () => {
    expect(clientLabel(url('?client=Codex<script>'), 'claude-code/2')).toBe('Codexscript (MCP)');
  });
});

describe('board tools', () => {
  it('maps what people type to the stored display_id spellings', () => {
    expect(displayIdCandidates('plt-003')).toEqual(expect.arrayContaining(['ELE_PLT-003', 'el_PLT-003', 'ELE_plt-003']));
    expect(displayIdCandidates('ELE_PLT-003')).toContain('ELE_PLT-003');
    expect(displayIdCandidates('  ')).toEqual([]);
  });

  it('resolves display_ids and refuses a UUID the caller cannot see', async () => {
    const { db } = fakeDb({ elements: [{ id: UUID, display_id: 'ELE_PLT-003' }] });
    expect(await resolveElementId(db, 'PLT-003')).toBe(UUID);
    expect(await resolveElementId(db, UUID)).toBe(UUID);
    expect(await resolveElementId(db, OTHER)).toBeNull();
    expect(await resolveElementId(db, '003')).toBe(UUID);
  });

  it('writes comments in the table’s columns, as the agent, traceable to the person', async () => {
    const { db, writes } = fakeDb({ elements: [{ id: UUID, display_id: 'ELE_PLT-003' }] });
    const res = await runBoardTool(db, 'addElementComment', { elementId: 'PLT-003', body: '確認しました' }, { agent: 'Claude Code (MCP)', userId: 'user-1' });
    expect(res.ok).toBe(true);
    const comment = writes.find(w => w.table === 'element_comments')!.row;
    expect(comment).toMatchObject({ element_id: UUID, content: '確認しました', author_kind: 'ai_agent', author_name: 'Claude Code (MCP)', author_id: 'user-1' });
    // The comment carries its author; like the app, it adds no Activity line.
    expect(writes.some(w => w.table === 'element_activity')).toBe(false);
  });

  it('records an update on the Activity rail and normalises progress with status', async () => {
    const { db, writes } = fakeDb({ elements: [{ id: UUID, display_id: 'ELE_PLT-003', status: 'todo' }] });
    const res = await runBoardTool(db, 'updateElement', { id: UUID, status: 'done' }, { agent: 'ChatGPT (MCP)', userId: 'user-1' });
    expect(res.ok).toBe(true);
    expect(writes.find(w => w.table === 'elements')!.row).toMatchObject({ status: 'done', progress: 100 });
    expect(writes.find(w => w.table === 'element_activity')!.row).toMatchObject({ detail: 'Updated status — via ChatGPT (MCP)' });
  });

  it('does not write to an Element the caller cannot see', async () => {
    const { db, writes } = fakeDb({ elements: [] });
    const res = await runBoardTool(db, 'addElementComment', { elementId: OTHER, body: 'x' }, { agent: 'AI (MCP)', userId: 'user-1' });
    expect(res).toEqual({ ok: false, error: 'Element not found' });
    expect(writes).toEqual([]);
  });

  it('does not toggle a Sub-element whose parent the caller cannot see', async () => {
    const SUB = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000001';
    const { db, writes } = fakeDb({ elements: [{ id: SUB, parent_id: OTHER, title: 'hidden', status: 'todo' }] });
    const res = await runBoardTool(db, 'toggleSubelementComplete', { id: SUB, isCompleted: true }, { agent: 'AI (MCP)', userId: 'user-1' });
    expect(res).toEqual({ ok: false, error: 'Sub-element not found' });
    expect(writes).toEqual([]);
  });

  it('describes patches and reads Supabase error objects', () => {
    expect(describePatch({ status: 'done', progress: 100, updated_at: 'x' })).toBe('Updated status');
    expect(errorMessage({ message: 'permission denied' })).toBe('permission denied');
  });
});

describe('mcpHost', () => {
  it('sends strategy tools to the strategy runner and board tools to the board runner', async () => {
    const { db } = fakeDb({ strategies: [{ id: UUID, name: 'Clayware GTM', status: 'active' }], intents: [], strategy_objects: [], strategy_children: [] });
    const h = mcpHost(db, { agent: 'AI (MCP)', userId: 'u' });
    const res = await h.call('getInitiative', { id: UUID });
    expect(res).toMatchObject({ ok: true, data: { name: 'Clayware GTM', intents: [], objects: [] } });
  });
});
