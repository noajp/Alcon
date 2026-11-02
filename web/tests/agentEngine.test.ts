import { describe, expect, it } from 'vitest';

const loop = await import(new URL('../../supabase/functions/run-agent/loop.ts', import.meta.url).pathname);
const tools = await import(new URL('../../supabase/functions/run-agent/agentTools.ts', import.meta.url).pathname);
const ctx = await import(new URL('../../supabase/functions/run-agent/context.ts', import.meta.url).pathname);
const pricing = await import(new URL('../../supabase/functions/_shared/aiPricing.ts', import.meta.url).pathname);
const client = await import(new URL('../../supabase/functions/_shared/integrationClient.ts', import.meta.url).pathname);

const { runLoop, appendDecisionResults, canonicalCalls, orderResults } = loop;

type Block = Record<string, unknown>;
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): Block => ({ type: 'tool_use', id, name, input });
const text = (t: string): Block => ({ type: 'text', text: t });

/** A scripted model: each call returns the next turn. Records what it was sent. */
function scripted(turns: { content: Block[]; stop_reason?: string }[]) {
  const sent: unknown[][] = [];
  let i = 0;
  return {
    sent,
    callModel: async (messages: unknown[]) => {
      sent.push(JSON.parse(JSON.stringify(messages)));
      const t = turns[i++] ?? { content: [text('done')], stop_reason: 'end_turn' };
      return { content: t.content, stop_reason: t.stop_reason ?? (t.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'), usage: { input_tokens: 10, output_tokens: 5 } };
    },
  };
}

const KIND: Record<string, string> = { log_progress: 'internal', getElement: 'board', send_email: 'write', read_inbox: 'read', finish: 'finish' };

function deps(model: ReturnType<typeof scripted>, over: Partial<Record<string, unknown>> = {}) {
  const executed: string[] = [];
  return {
    executed,
    deps: {
      callModel: model.callModel,
      kindOf: (n: string) => (KIND[n] === 'read' ? 'write' : KIND[n] ?? 'board'),
      needsApproval: (c: { name: string }) => KIND[c.name] === 'write',
      execute: async (c: { name: string; input: Record<string, unknown> }) => {
        executed.push(c.name);
        if (c.name === 'finish') return { content: 'ok', finish: { outcome: c.input.outcome ?? 'completed', summary: String(c.input.summary ?? ''), message: String(c.input.message ?? '') } };
        return { content: `${c.name} ok` };
      },
      onUsage: async () => {},
      budgetExceeded: () => false,
      cancelled: async () => false,
      ...over,
    },
  };
}

const limits = (over = {}) => ({ maxTurnsThisCall: 10, maxTotalTurns: 50, deadline: Date.now() + 60_000, ...over });
const fresh = () => ({ messages: [{ role: "user", content: "task" }] as { role: string; content: unknown }[], turns: 0, nudges: 0 });

describe('agent loop', () => {
  it('runs tools, answers every tool_use in one user message, and finishes', async () => {
    const m = scripted([
      { content: [text('plan'), toolUse('a', 'getElement', { id: 'x' }), toolUse('b', 'log_progress', { title: 't' })] },
      { content: [toolUse('c', 'finish', { outcome: 'completed', summary: 's', message: 'm' })] },
    ]);
    const { deps: d, executed } = deps(m);
    const state = fresh();
    const out = await runLoop(state, d, limits());
    expect(out).toEqual({ kind: 'finished', finish: { outcome: 'completed', summary: 's', message: 'm' } });
    expect(executed).toEqual(['getElement', 'log_progress', 'finish']);
    const answer = state.messages[2] as { role: string; content: { tool_use_id: string }[] };
    expect(answer.role).toBe('user');
    expect(answer.content.map((r) => r.tool_use_id)).toEqual(['a', 'b']);
  });

  it('stops for approval with every write of the turn batched, after running the reads', async () => {
    const m = scripted([{ content: [toolUse('r', 'read_inbox'), toolUse('w1', 'send_email', { to: 'a' }), toolUse('w2', 'send_email', { to: 'b' })] }]);
    const { deps: d, executed } = deps(m);
    const state = fresh();
    const out = await runLoop(state, d, limits());
    expect(out.kind).toBe('approval');
    expect(out.pending.calls.map((c: { id: string }) => c.id)).toEqual(['w1', 'w2']);
    expect(out.pending.partial.map((r: { tool_use_id: string }) => r.tool_use_id)).toEqual(['r']);
    expect(executed).toEqual(['read_inbox']);
    // The paused turn is the last message; nothing has answered it yet.
    expect((state.messages.at(-1) as { role: string }).role).toBe('assistant');

    appendDecisionResults(state, out.pending, [
      { type: 'tool_result', tool_use_id: 'w2', content: 'sent' },
      { type: 'tool_result', tool_use_id: 'w1', content: 'sent' },
    ]);
    const answer = state.messages.at(-1) as { role: string; content: { tool_use_id: string }[] };
    expect(answer.role).toBe('user');
    expect(answer.content.map((r) => r.tool_use_id)).toEqual(['r', 'w1', 'w2']);
  });

  it('does not let a run finish in the same turn as writes still waiting', async () => {
    const m = scripted([{ content: [toolUse('w', 'send_email'), toolUse('f', 'finish', { outcome: 'completed', summary: 's', message: 'm' })] }]);
    const { deps: d, executed } = deps(m);
    const out = await runLoop(fresh(), d, limits());
    expect(out.kind).toBe('approval');
    expect(executed).not.toContain('finish');
    expect(out.pending.partial).toEqual([expect.objectContaining({ tool_use_id: 'f', is_error: true })]);
  });

  it('runs a fully delegated write without stopping', async () => {
    const m = scripted([
      { content: [toolUse('w', 'send_email')] },
      { content: [toolUse('f', 'finish', { outcome: 'completed', summary: 's', message: 'm' })] },
    ]);
    const { deps: d, executed } = deps(m, { needsApproval: () => false });
    const out = await runLoop(fresh(), d, limits());
    expect(out.kind).toBe('finished');
    expect(executed).toEqual(['send_email', 'finish']);
  });

  it('treats a plain answer as the end of the run', async () => {
    const out = await runLoop(fresh(), deps(scripted([{ content: [text('返信しました\n詳細')] }])).deps, limits());
    expect(out).toEqual({ kind: 'finished', finish: { outcome: 'completed', summary: '返信しました', message: '返信しました\n詳細' } });
  });

  it('yields when the slice is used up, and stops on budget, cancellation, the turn cap and refusal', async () => {
    const busy = () => scripted(Array.from({ length: 20 }, (_, i) => ({ content: [toolUse(`t${i}`, 'getElement')] })));
    expect((await runLoop(fresh(), deps(busy()).deps, limits({ maxTurnsThisCall: 3 }))).kind).toBe('yield');
    expect((await runLoop(fresh(), deps(busy()).deps, limits({ maxTotalTurns: 2 }))).kind).toBe('limit');
    expect((await runLoop(fresh(), deps(busy(), { budgetExceeded: () => true }).deps, limits())).kind).toBe('budget');
    expect((await runLoop(fresh(), deps(busy(), { cancelled: async () => true }).deps, limits())).kind).toBe('cancelled');
    expect((await runLoop(fresh(), deps(scripted([{ content: [text('no')], stop_reason: 'refusal' }])).deps, limits())).kind).toBe('refusal');
  });

  it('binds a decision to the exact batch regardless of key order', () => {
    const a = canonicalCalls([{ id: '1', name: 'x', input: { b: 1, a: { d: 2, c: 3 } } }]);
    const b = canonicalCalls([{ id: '1', name: 'x', input: { a: { c: 3, d: 2 }, b: 1 } }]);
    expect(a).toBe(b);
    expect(canonicalCalls([{ id: '1', name: 'x', input: { b: 2 } }])).not.toBe(canonicalCalls([{ id: '1', name: 'x', input: { b: 1 } }]));
  });

  it('fills a missing result rather than leaving a tool_use unanswered', () => {
    expect(orderResults([{ id: 'a', name: 'n', input: {} }], [])).toEqual([{ type: 'tool_result', tool_use_id: 'a', content: 'No result.', is_error: true }]);
  });
});

describe('agent tools', () => {
  it('offers reads and everyday writes on the board, never deletes or bulk writes', () => {
    const names = tools.baseAgentTools().map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['finish', 'save_artifact', 'getElement', 'createElement', 'getInitiative']));
    expect(names.some((n: string) => /delete|bulk|move/i.test(n))).toBe(false);
    expect(tools.baseKindOf('finish')).toBe('finish');
    expect(tools.baseKindOf('updateElement')).toBe('board');
    expect(tools.baseKindOf('linear_ab12__create_issue')).toBeNull();
  });

  it('summarises a batch of writes in one line', () => {
    expect(tools.approvalSummary([
      { integration: 'Echo Test', operation: 'POST /notify' },
      { integration: 'Echo Test', operation: 'POST /notify' },
      { integration: 'Linear', operation: 'create_issue' },
    ])).toBe('Echo Test · POST /notify × 2、Linear · create_issue');
  });

  it('keeps integration tool prefixes stable and valid', () => {
    expect(tools.integrationPrefix('Linear', '4f3a2b1c-0000-0000-0000-000000000000')).toBe('linear_4f3a');
    expect(tools.integrationPrefix('Google ドライブ', 'abcd')).toBe('google_abcd');
    expect(tools.integrationPrefix('日本語', 'ffff0000')).toBe('x_ffff');
  });
});

describe('integration client guards', () => {
  it('only calls https on public hosts', () => {
    expect(client.isSafeEndpoint('https://mcp.linear.app/mcp')).toBe(true);
    for (const bad of ['http://example.com', 'https://localhost:3000', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.2', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://user:pw@example.com', 'https://intranet', 'https://db.internal']) {
      expect(client.isSafeEndpoint(bad)).toBe(false);
    }
  });

  it('refuses trailing-dot, IPv6 and benchmark-range hosts too', () => {
    for (const bad of ['https://localhost./x', 'https://metadata.google.internal./x', 'https://[::127.0.0.1]/', 'https://[64:ff9b::a00:1]/', 'https://[fec0::1]/', 'https://198.18.0.1/']) {
      expect(client.isSafeEndpoint(bad)).toBe(false);
    }
    expect(client.isSafeEndpoint('https://app.asana.com/api/1.0')).toBe(true);
  });

  it('judges resolved addresses, not just the host name', () => {
    for (const ok of ['8.8.8.8', '151.101.1.69', '192.0.78.9', '2606:4700::6810:84e5', '2001:4860:4860::8888']) expect(client.isPublicAddress(ok)).toBe(true);
    for (const bad of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.3.4', '192.168.0.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1',
      '::1', '::', 'fd00::1', 'fe80::1', 'fec0::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1']) {
      expect(client.isPublicAddress(bad)).toBe(false);
    }
  });

  it('refuses a public name that resolves to a private address', async () => {
    const dns = (table: Record<string, string[]>) => async (host: string, type: 'A' | 'AAAA') => {
      const hit = table[`${host}/${type}`];
      if (!hit) throw new Error('NXDOMAIN');
      return hit;
    };
    expect(await client.resolvesToPublic('https://api.example.com/x', dns({ 'api.example.com/A': ['93.184.216.34'] }))).toBe(true);
    expect(await client.resolvesToPublic('https://evil.example.com/x', dns({ 'evil.example.com/A': ['169.254.169.254'] }))).toBe(false);
    expect(await client.resolvesToPublic('https://mixed.example.com/x', dns({ 'mixed.example.com/A': ['93.184.216.34'], 'mixed.example.com/AAAA': ['::1'] }))).toBe(false);
    const nx = async () => { const e = new Error('no record'); e.name = 'NotFound'; throw e; };
    expect(await client.resolvesToPublic('https://nothing.example.com/x', nx)).toBe(false);
    // No usable resolver: the host-name check alone decides, as before.
    expect(await client.resolvesToPublic('https://api.example.com/x', null)).toBe(true);
    expect(await client.resolvesToPublic('https://api.example.com/x', async () => { throw new Error('PermissionDenied'); })).toBe(true);
    // Address literals are judged as written, without DNS.
    expect(await client.resolvesToPublic('https://93.184.216.34/x', nx)).toBe(true);
    expect(await client.resolvesToPublic('https://10.0.0.1/x', nx)).toBe(false);
    expect(await client.resolvesToPublic('http://api.example.com/x', dns({ 'api.example.com/A': ['93.184.216.34'] }))).toBe(false);
  });

  it('believes a server\'s readOnlyHint only from vetted presets, and never for a write-named tool', () => {
    const github = { preset: 'github', endpoint: 'https://api.githubcopilot.com/mcp/' };
    expect(client.trustsReadOnlyHint(github, 'get_issue')).toBe(true);
    expect(client.trustsReadOnlyHint(github, 'list_pull_requests')).toBe(true);
    expect(client.trustsReadOnlyHint(github, 'create_issue')).toBe(false);
    expect(client.trustsReadOnlyHint(github, 'merge_pull_request')).toBe(false);
    expect(client.trustsReadOnlyHint({ preset: 'linear', endpoint: 'https://mcp.linear.app/mcp' }, 'search_issues')).toBe(true);
    // Custom servers, or a preset pointed somewhere else, label nothing.
    expect(client.trustsReadOnlyHint({ preset: null, endpoint: 'https://mcp.example.com/mcp' }, 'get_secret')).toBe(false);
    expect(client.trustsReadOnlyHint({ preset: 'github', endpoint: 'https://evil.example.com/mcp' }, 'get_issue')).toBe(false);
  });

  it('reads at most the cap of a response body', async () => {
    const big = new Response('x'.repeat(5000));
    expect((await client.readCapped(big, 1000)).length).toBe(1000);
    expect(await client.readCapped(new Response('ok'), 1000)).toBe('ok');
  });

  it('keeps an http_request under its base URL', () => {
    expect(client.resolveUnderBase('https://app.asana.com/api/1.0', '/tasks/1', { opt_fields: 'name' })).toBe('https://app.asana.com/api/1.0/tasks/1?opt_fields=name');
    for (const bad of ['https://evil.com/x', '//evil.com/x', '../../../admin', '/../1.1/x']) {
      expect(() => client.resolveUnderBase('https://app.asana.com/api/1.0', bad)).toThrow();
    }
  });

  it('reads the matching JSON-RPC reply from JSON or SSE', () => {
    expect(client.parseRpcBody('application/json', '{"jsonrpc":"2.0","id":2,"result":{"ok":1}}', 2)).toEqual({ jsonrpc: '2.0', id: 2, result: { ok: 1 } });
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[]}}\n';
    expect(client.parseRpcBody('text/event-stream', sse, 3)).toEqual({ jsonrpc: '2.0', id: 3, result: { tools: [] } });
    expect(client.parseRpcBody('application/json', 'nope', 1)).toBeNull();
  });

  it('puts the secret only in the configured header', () => {
    const row = { id: 'i', kind: 'http', name: 'n', description: null, endpoint: 'https://x.io', auth_type: 'header', auth_header: 'X-Api-Key', delegation: 'approve_each' };
    expect(client.authHeaders(row, 's')).toEqual({ 'X-Api-Key': 's' });
    expect(client.authHeaders({ ...row, auth_type: 'bearer' }, 's')).toEqual({ Authorization: 'Bearer s' });
    expect(client.authHeaders({ ...row, auth_type: 'none' }, 's')).toEqual({});
  });
});

describe('pricing and prompts', () => {
  it('prices usage including cache writes and reads', () => {
    // 1M input on Sonnet 5.5 = $2; 1M output = $10; cache write 1.25x; read 0.1x.
    expect(pricing.costOf('claude-sonnet-5-5', { input_tokens: 1_000_000 })).toBe(2);
    expect(pricing.costOf('claude-sonnet-5-5', { output_tokens: 100_000 })).toBe(1);
    expect(pricing.costOf('claude-haiku-4-5', { cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 1_000_000 })).toBe(1.35);
    expect(pricing.costOf('claude-opus-5-5', { cache_read_input_tokens: 1_000_000 })).toBe(0.2);
    expect(pricing.costAt({ input: 0.3, output: 1.2, cacheRead: 0.3 }, { input_tokens: 1_000_000, output_tokens: 500_000 })).toBe(0.9);
    expect(pricing.isAgentModel('claude-opus-5-5')).toBe(true);
    expect(pricing.isAgentModel('gpt-5')).toBe(false);
  });

  it('frames a reply around the comment and treats outside text as data', () => {
    const base = {
      mode: 'reply', prompt: '税込にして', element: { id: 'e', display_id: 'ELE_X-1', title: '経費処理', description: null, status: 'todo', priority: 'high', due_date: null, labels: [] },
      objectName: null, subelements: [], initiatives: [], comments: [], previousRuns: [], artifacts: [], integrations: [], today: '2026-10-03',
    };
    const msg = ctx.taskMessage(base);
    expect(msg).toContain('税込にして');
    expect(msg).toContain('経費処理');
    expect(ctx.systemPrompt({ name: 'Claude', instructions: null })).toContain('データ');
  });
});
