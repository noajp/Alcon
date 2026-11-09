import { describe, expect, it } from 'vitest';

const vr = await import(new URL('../../supabase/functions/_shared/verifyReads.ts', import.meta.url).pathname);
const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const it8n = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname);

// Verify-reads (B2): a write's success becomes a fact about the world.
// The fixtures are the design's PR3 acceptance in miniature — the GitHub
// smoke flow's two declared writes, proven against stub transports.

type Cmd = { name: string; effect: string; input: Record<string, unknown>; required: string[] };

const FILE_MANIFEST = cm.parseManifest({
  version: 2,
  commands: [
    { name: 'get_file_contents', action: 'repos.get_file', effect: 'read', mcp: 'get_file_contents' },
    {
      name: 'create_or_update_file', action: 'repos.write_file', effect: 'write', mcp: 'create_or_update_file',
      verify: { command: 'get_file_contents', expect: { content: 'content' } },
    },
    { name: 'plain_write', action: 'repos.plain', effect: 'write', mcp: 'plain_write' },
  ],
}).manifest;

const cmd = (name: string): Cmd => FILE_MANIFEST.commands.find((c: Cmd) => c.name === name);

describe('expectedOfVerify', () => {
  it('takes an input field by name and keeps anything else literal', () => {
    const decl = { command: 'get_file_contents', expect: { content: 'content', kind: 'file', n: 3 }, delayMs: 0 };
    expect(vr.expectedOfVerify(decl, { content: 'BODY', path: 'x.md' })).toEqual({ content: 'BODY', kind: 'file', n: 3 });
  });

  it('falls back to the write’s result state, the input still winning (P2)', () => {
    const decl = { command: 'gmail_read', expect: { threadId: 'threadId' }, delayMs: 0 };
    // A fresh send: no threadId was an input, so the expectation is
    // the created message’s own thread — the check reduces to the
    // read-back of the created id existing in that thread.
    expect(vr.expectedOfVerify(decl, { to: 'a@example.co.jp', body: 'b' }, { id: 'm1', threadId: 't-new' }))
      .toEqual({ threadId: 't-new' });
    // A reply: the caller named the thread, and the intent wins over
    // whatever the result reported.
    expect(vr.expectedOfVerify(decl, { threadId: 't-named' }, { id: 'm2', threadId: 't-other' }))
      .toEqual({ threadId: 't-named' });
    // Neither side names it: the value stays the literal it was.
    expect(vr.expectedOfVerify(decl, {}, {})).toEqual({ threadId: 'threadId' });
  });
});

describe('verifyReadInput', () => {
  it('overlays the write result state on the write input (a created number reaches the read)', () => {
    const input = vr.verifyReadInput(cmd('get_file_contents'), { owner: 'o', repo: 'r', head: 'b1' }, '{"number": 7, "state": "open"}');
    expect(input).toMatchObject({ owner: 'o', repo: 'r', head: 'b1', number: 7, state: 'open' });
  });

  it('narrows to the fields the read command declares, when it declares any', () => {
    const read = { ...cmd('get_file_contents'), input: { owner: {}, repo: {}, path: {} } };
    const input = vr.verifyReadInput(read, { owner: 'o', repo: 'r', path: 'p', content: 'x' }, '{}');
    expect(input).toEqual({ owner: 'o', repo: 'r', path: 'p' });
  });

  it('leaves long payloads out of an undeclared read input', () => {
    const big = 'x'.repeat(1500);
    const input = vr.verifyReadInput(cmd('get_file_contents'), { owner: 'o', content: big }, '{}');
    expect(input).toEqual({ owner: 'o' });
  });
});

describe('runVerifyRead', () => {
  const decl = { command: 'get_file_contents', expect: { content: 'content' }, delayMs: 0 };
  const base = { manifest: FILE_MANIFEST, declaration: decl, writeInput: { owner: 'o', repo: 'r', path: 'a.md', content: 'NEW' }, writeResultText: '{"sha": "abc"}' };

  it('is ok when the read-back matches the intent', async () => {
    const seen: Record<string, unknown>[] = [];
    const check = await vr.runVerifyRead({
      ...base,
      deps: { callRead: async (_c: Cmd, input: Record<string, unknown>) => { seen.push(input); return { text: 'NEW', isError: false }; } },
    });
    expect(check).toEqual({ ok: true });
    expect(seen[0]).toMatchObject({ owner: 'o', repo: 'r', path: 'a.md' });
  });

  it('is a mismatch with a diff when the read-back disagrees', async () => {
    const check = await vr.runVerifyRead({
      ...base,
      deps: { callRead: async () => ({ text: 'OLD', isError: false }) },
    });
    expect(check.ok).toBe(false);
    expect(check.diff).toEqual([{ field: 'content', expected: 'NEW', actual: 'OLD' }]);
    expect(check.unverified).toBeUndefined();
  });

  it('is unverified — never a mismatch — when the read itself fails', async () => {
    const check = await vr.runVerifyRead({
      ...base,
      deps: { callRead: async () => ({ text: 'HTTP 503', isError: true }) },
    });
    expect(check.ok).toBe(false);
    expect(check.unverified).toContain('読み取りが失敗');
    expect(check.diff).toBeUndefined();
  });

  it('is unverified when the read cannot be addressed (a required field is missing)', async () => {
    const manifest = cm.parseManifest({
      version: 2,
      commands: [
        { name: 'get_thing', effect: 'read', mcp: 'get_thing', required: ['thing_id'] },
        { name: 'make_thing', effect: 'write', mcp: 'make_thing', verify: { command: 'get_thing', expect: { state: 'open' } } },
      ],
    }).manifest;
    const check = await vr.runVerifyRead({
      manifest, declaration: manifest.commands.find((c: Cmd) => c.name === 'make_thing').verify,
      writeInput: { name: 'x' }, writeResultText: '{}',
      deps: { callRead: async () => ({ text: '{}', isError: false }) },
    });
    expect(check.unverified).toContain('thing_id');
  });

  it('retries exactly once after the declared delay, and the second answer stands', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const check = await vr.runVerifyRead({
      ...base, declaration: { ...decl, delayMs: 250 },
      deps: {
        callRead: async () => { calls++; return { text: calls === 1 ? 'STALE' : 'NEW', isError: false }; },
        sleep: async (ms: number) => { sleeps.push(ms); },
      },
    });
    expect(check).toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([250]);
  });

  it('does not retry without a delay, and a standing mismatch after retry is final', async () => {
    let calls = 0;
    const noDelay = await vr.runVerifyRead({
      ...base,
      deps: { callRead: async () => { calls++; return { text: 'OLD', isError: false }; } },
    });
    expect(noDelay.ok).toBe(false);
    expect(calls).toBe(1);
    calls = 0;
    const retried = await vr.runVerifyRead({
      ...base, declaration: { ...decl, delayMs: 10 },
      deps: { callRead: async () => { calls++; return { text: 'OLD', isError: false }; }, sleep: async () => {} },
    });
    expect(retried.ok).toBe(false);
    expect(retried.diff).toEqual([{ field: 'content', expected: 'NEW', actual: 'OLD' }]);
    expect(calls).toBe(2);
  });
});

describe('tallyVerify', () => {
  it('counts each outcome in its own class', () => {
    let t = vr.emptyVerifyTally();
    t = vr.tallyVerify(t, { ok: true });
    t = vr.tallyVerify(t, { ok: false, diff: [{ field: 'x', expected: 1, actual: 2 }] });
    t = vr.tallyVerify(t, { ok: false, unverified: 'no read' });
    expect(t).toEqual({ checked: 3, ok: 1, mismatched: 1, unverified: 1 });
  });
});

// ── The executor, end to end over a stub MCP session ────────────────────

interface StubCall { name: string; args: Record<string, unknown> }

function githubTool(manifest: unknown, commandName: string, session: unknown) {
  const parsed = cm.parseManifest(manifest).manifest;
  const command = parsed.commands.find((c: Cmd) => c.name === commandName);
  return {
    integration: { id: 'int-gh', preset: 'github', kind: 'mcp', name: 'GitHub', description: null, endpoint: 'https://api.githubcopilot.com/mcp/', auth_type: 'oauth', auth_header: null, delegation: 'approve_each' },
    remote: { name: command.mcp, description: '', inputSchema: {}, readOnly: command.effect === 'read' },
    command, manifest: parsed, session,
  };
}

const GH_MANIFEST = {
  version: 1,
  commands: [
    { name: 'get_file_contents', effect: 'read', mcp: 'get_file_contents' },
    { name: 'create_or_update_file', effect: 'write', mcp: 'create_or_update_file', verify: { command: 'get_file_contents', expect: { content: 'content' } }, reversibility: 'contained' },
    { name: 'get_pull_request', effect: 'read', mcp: 'get_pull_request' },
    { name: 'create_pull_request', effect: 'write', mcp: 'create_pull_request', verify: { command: 'get_pull_request', expect: { head: 'head', base: 'base' } }, reversibility: 'contained' },
  ],
};

const sessionWith = (handlers: Record<string, (args: Record<string, unknown>) => { text: string; isError: boolean }>) => {
  const calls: StubCall[] = [];
  return {
    calls,
    session: {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const h = handlers[name];
        return h ? h(args) : { text: `no stub for ${name}`, isError: true };
      },
    },
  };
};

describe('executeIntegrationTool with a verify declaration', () => {
  const writeFile = { id: 'c1', name: 'gh__create_or_update_file', input: { owner: 'noajp', repo: 'Alcon', path: 'SMOKE.md', branch: 'claude/smoke', content: '# Smoke\n', message: 'smoke' } };

  it('records ok:true and leaves the result untouched when the read-back matches', async () => {
    const { session, calls } = sessionWith({
      create_or_update_file: () => ({ text: '{"sha": "f00"}', isError: false }),
      get_file_contents: () => ({ text: '# Smoke\n', isError: false }),
    });
    const r = await it8n.executeIntegrationTool(githubTool(GH_MANIFEST, 'create_or_update_file', session), writeFile);
    expect(r.isError).toBe(false);
    expect(r.text).toBe('{"sha": "f00"}');
    expect(r.verify).toEqual({ ok: true });
    expect(calls.map((c) => c.name)).toEqual(['create_or_update_file', 'get_file_contents']);
    expect(calls[1].args).toMatchObject({ owner: 'noajp', repo: 'Alcon', path: 'SMOKE.md' });
  });

  it('answers a mismatch as an error naming the field, with the diff on the record', async () => {
    const { session } = sessionWith({
      create_or_update_file: () => ({ text: '{"sha": "f00"}', isError: false }),
      get_file_contents: () => ({ text: '# Something else\n', isError: false }),
    });
    const r = await it8n.executeIntegrationTool(githubTool(GH_MANIFEST, 'create_or_update_file', session), writeFile);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('content');
    expect(r.verify).toEqual({ ok: false, diff: [{ field: 'content', expected: '# Smoke\n', actual: '# Something else\n' }] });
  });

  it('keeps the write standing, marked unverified, when the read-back fails', async () => {
    const { session } = sessionWith({
      create_or_update_file: () => ({ text: '{"sha": "f00"}', isError: false }),
      get_file_contents: () => ({ text: 'HTTP 503', isError: true }),
    });
    const r = await it8n.executeIntegrationTool(githubTool(GH_MANIFEST, 'create_or_update_file', session), writeFile);
    expect(r.isError).toBe(false);
    expect(r.text).toContain('読み戻し確認はできませんでした');
    expect(r.verify.ok).toBe(false);
    expect(r.verify.unverified).toBeTruthy();
  });

  it('never re-runs the write, however the read-back ends', async () => {
    const { session, calls } = sessionWith({
      create_or_update_file: () => ({ text: '{"sha": "f00"}', isError: false }),
      get_file_contents: () => ({ text: 'DIFFERENT', isError: false }),
    });
    await it8n.executeIntegrationTool(githubTool(GH_MANIFEST, 'create_or_update_file', session), writeFile);
    expect(calls.filter((c) => c.name === 'create_or_update_file')).toHaveLength(1);
  });

  it('runs no read-back for a write without a declaration', async () => {
    const manifest = { version: 1, commands: [{ name: 'create_or_update_file', effect: 'write', mcp: 'create_or_update_file' }] };
    const { session, calls } = sessionWith({ create_or_update_file: () => ({ text: 'done', isError: false }) });
    const r = await it8n.executeIntegrationTool(githubTool(manifest, 'create_or_update_file', session), writeFile);
    expect(r.verify).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('verifies a created pull request by reading it back (head/base), addressed by its number', async () => {
    const { session, calls } = sessionWith({
      create_pull_request: () => ({ text: '{"number": 777, "state": "open"}', isError: false }),
      get_pull_request: () => ({ text: '{"number": 777, "head": "claude/smoke-test", "base": "main", "state": "open"}', isError: false }),
    });
    const call = { id: 'c2', name: 'gh__create_pull_request', input: { owner: 'noajp', repo: 'Alcon', title: 'smoke', head: 'claude/smoke-test', base: 'main' } };
    const r = await it8n.executeIntegrationTool(githubTool(GH_MANIFEST, 'create_pull_request', session), call);
    expect(r.verify).toEqual({ ok: true });
    expect(calls[1].name).toBe('get_pull_request');
    expect(calls[1].args).toMatchObject({ owner: 'noajp', repo: 'Alcon', number: 777 });
  });

  it('flags a pull request whose read-back branches are not the ones intended', async () => {
    const { session } = sessionWith({
      create_pull_request: () => ({ text: '{"number": 777}', isError: false }),
      get_pull_request: () => ({ text: '{"number": 777, "head": "someone-elses-branch", "base": "main"}', isError: false }),
    });
    const call = { id: 'c3', name: 'gh__create_pull_request', input: { owner: 'noajp', repo: 'Alcon', head: 'claude/smoke-test', base: 'main' } };
    const r = await it8n.executeIntegrationTool(githubTool(GH_MANIFEST, 'create_pull_request', session), call);
    expect(r.isError).toBe(true);
    expect(r.verify.diff).toEqual([{ field: 'head', expected: 'claude/smoke-test', actual: 'someone-elses-branch' }]);
  });

  it('a verify read refused by the manifest rules is unverified, not a mismatch', async () => {
    const manifest = {
      version: 1,
      commands: [
        { name: 'get_file_contents', effect: 'read', mcp: 'get_file_contents', rules: [{ when: { repo: 'Alcon' }, permission: 'deny' }] },
        { name: 'create_or_update_file', effect: 'write', mcp: 'create_or_update_file', verify: { command: 'get_file_contents', expect: { content: 'content' } } },
      ],
    };
    const { session, calls } = sessionWith({
      create_or_update_file: () => ({ text: '{"sha": "f00"}', isError: false }),
      get_file_contents: () => ({ text: '# Smoke\n', isError: false }),
    });
    const r = await it8n.executeIntegrationTool(githubTool(manifest, 'create_or_update_file', session), writeFile);
    expect(r.isError).toBe(false);
    expect(r.verify.unverified).toBeTruthy();
    // The refusal happened at the executor's own recheck: the read never ran.
    expect(calls.map((c) => c.name)).toEqual(['create_or_update_file']);
  });
});
