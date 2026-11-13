import { describe, expect, it } from 'vitest';

const pm = await import(new URL('../../supabase/functions/_shared/planMode.ts', import.meta.url).pathname);
const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const loop = await import(new URL('../../supabase/functions/_shared/agentLoop.ts', import.meta.url).pathname);
const oauth = await import(new URL('../../supabase/functions/_shared/googleOAuth.ts', import.meta.url).pathname);
const oc = await import(new URL('../../supabase/functions/_shared/outcomeCollector.ts', import.meta.url).pathname);

// Plan mode (B8): the plan record and its apply-time matching. The
// security contract under test: coverage is decided by the canonical
// ARGUMENT key (the approval machinery's canonicalCalls, ids excluded —
// ids are per-run mintings, not arguments), a plan lists a call or it
// does not cover it, denied / unassemblable entries never cover, each
// entry covers exactly one execution, and a listed CRITICAL call does
// cover (owner decision §9.5: hash-bound to the listed calls only).

type Call = { id: string; name: string; input: Record<string, unknown> };
type Cmd = { name: string; effect: string; input: Record<string, unknown>; required: string[] };

const writeFile = (id: string, content = '# Smoke\n'): Call => ({
  id, name: 'gh__create_or_update_file',
  input: { owner: 'noajp', repo: 'Clayware', path: 'SMOKE.md', branch: 'claude/smoke', content, message: 'smoke' },
});

const display = { id: 'd1', integration: 'GitHub', operation: 'create_or_update_file', destination: 'GitHub', detail: null, effect: 'write', critical: null, rememberable: false, title: 'ファイルを作成', fields: [], preview: null, askReason: null };

const entryOf = async (call: Call, over: Record<string, unknown> = {}) => ({
  call, key: await pm.planCallKey(call), label: 'GitHub: create_or_update_file',
  display, critical: null, denied: false, problem: null, expected: null, ...over,
});

const planOf = async (calls: Call[], overs: Record<string, unknown>[] = []) => {
  const entries = [];
  for (let i = 0; i < calls.length; i++) entries.push(await entryOf(calls[i], overs[i]));
  return { v: 1, planRunId: 'run-plan', actionId: 'act-plan', hash: await pm.planHashOf(calls), calls: entries };
};

describe('planCallKey', () => {
  it('is the canonical argument hash: same arguments, same key — the call id is not an argument', async () => {
    const a = await pm.planCallKey(writeFile('plan-run-id'));
    const b = await pm.planCallKey(writeFile('apply-run-id'));
    expect(a).toBe(b);
    expect(a).toBe(await oauth.sha256Hex(loop.canonicalCalls([{ id: '', name: writeFile('x').name, input: writeFile('x').input }])));
  });

  it('changes when any argument changes, and ignores object key order', async () => {
    const base = await pm.planCallKey(writeFile('c1'));
    expect(await pm.planCallKey(writeFile('c1', '# Other\n'))).not.toBe(base);
    const reordered: Call = { id: 'c1', name: writeFile('x').name, input: { message: 'smoke', content: '# Smoke\n', branch: 'claude/smoke', path: 'SMOKE.md', repo: 'Clayware', owner: 'noajp' } };
    expect(await pm.planCallKey(reordered)).toBe(base);
  });
});

describe('planHashOf', () => {
  it('is the approval machinery hash over the recorded calls, order included', async () => {
    const calls = [writeFile('a'), writeFile('b', '# Two\n')];
    expect(await pm.planHashOf(calls)).toBe(await oauth.sha256Hex(loop.canonicalCalls(calls)));
    expect(await pm.planHashOf([calls[1], calls[0]])).not.toBe(await pm.planHashOf(calls));
  });
});

describe('matchPlanCall — the apply-time coverage rule', () => {
  it('applies exactly the planned calls: an apply call with the plan’s arguments matches', async () => {
    const plan = await planOf([writeFile('p1')]);
    const entry = pm.matchPlanCall(plan, await pm.planCallKey(writeFile('a9')));
    expect(entry?.call.id).toBe('p1');
  });

  it('a mutated argument finds no cover and asks on its own', async () => {
    const plan = await planOf([writeFile('p1')]);
    expect(pm.matchPlanCall(plan, await pm.planCallKey(writeFile('a9', '# Drifted\n')))).toBeNull();
    expect(pm.matchPlanCall(plan, await pm.planCallKey({ id: 'a9', name: 'gh__create_or_update_file', input: { ...writeFile('x').input, path: 'OTHER.md' } }))).toBeNull();
  });

  it('an unlisted call is never covered', async () => {
    const plan = await planOf([writeFile('p1')]);
    const other: Call = { id: 'a1', name: 'gh__create_pull_request', input: { owner: 'noajp', repo: 'Clayware', head: 'b', base: 'main' } };
    expect(pm.matchPlanCall(plan, await pm.planCallKey(other))).toBeNull();
  });

  it('a listed critical call IS covered — the plan approval the person gave names it', async () => {
    const plan = await planOf([writeFile('p1')], [{ critical: 'delete' }]);
    expect(pm.matchPlanCall(plan, await pm.planCallKey(writeFile('a9')))).not.toBeNull();
  });

  it('a denied or unassemblable entry never covers, even with matching arguments', async () => {
    const denied = await planOf([writeFile('p1')], [{ denied: true }]);
    expect(pm.matchPlanCall(denied, await pm.planCallKey(writeFile('a9')))).toBeNull();
    const broken = await planOf([writeFile('p1')], [{ problem: 'path が必要です' }]);
    expect(pm.matchPlanCall(broken, await pm.planCallKey(writeFile('a9')))).toBeNull();
  });

  it('each entry covers exactly one execution (multiset semantics)', async () => {
    const plan = await planOf([writeFile('p1'), writeFile('p2')]);
    const key = await pm.planCallKey(writeFile('a9'));
    const first = pm.matchPlanCall(plan, key);
    expect(first?.call.id).toBe('p1');
    first!.consumed = true;
    const second = pm.matchPlanCall(plan, key);
    expect(second?.call.id).toBe('p2');
    second!.consumed = true;
    expect(pm.matchPlanCall(plan, key)).toBeNull();
  });
});

describe('readRunPlan', () => {
  it('round-trips a sealed plan and reads anything malformed as no plan', async () => {
    const plan = await planOf([writeFile('p1')]);
    expect(pm.readRunPlan(JSON.parse(JSON.stringify(plan)))?.calls).toHaveLength(1);
    expect(pm.readRunPlan(null)).toBeNull();
    expect(pm.readRunPlan('plan')).toBeNull();
    expect(pm.readRunPlan({ v: 2, planRunId: 'r', hash: 'h', calls: [] })).toBeNull();
    expect(pm.readRunPlan({ v: 1, planRunId: 'r', hash: 'h', calls: [{ key: 1 }] })).toBeNull();
    expect(pm.readRunPlan({ v: 1, planRunId: 'r', hash: 'h' })).toBeNull();
  });
});

describe('preStateOf / preStateDrift — the drift check over the expected fields', () => {
  it('narrows a read state to the expected fields, absent ones named', () => {
    expect(pm.preStateOf({ content: 'A', other: 1 }, { content: 'x', sha: 'y' }))
      .toEqual({ values: { content: 'A' }, absent: ['sha'] });
  });

  it('no drift when the pre-state stands as the plan saw it', () => {
    const base = { values: { content: 'A' }, absent: ['sha'] };
    expect(pm.preStateDrift(base, { values: { content: 'A' }, absent: ['sha'] })).toEqual([]);
  });

  it('a changed value, an appeared field and a vanished field all drift', () => {
    const base = { values: { content: 'A', mode: 'x' }, absent: ['sha'] };
    expect(pm.preStateDrift(base, { values: { content: 'B', mode: 'x' }, absent: ['sha'] }))
      .toEqual([{ field: 'content', expected: 'A', actual: 'B' }]);
    expect(pm.preStateDrift(base, { values: { content: 'A', mode: 'x', sha: 's1' }, absent: [] }))
      .toEqual([{ field: 'sha', expected: undefined, actual: 's1' }]);
    expect(pm.preStateDrift(base, { values: { content: 'A' }, absent: ['sha', 'mode'] }))
      .toEqual([{ field: 'mode', expected: 'x', actual: undefined }]);
  });
});

// ── Verify expectations against a stub MCP session ──────────────────────

const GH_MANIFEST = {
  version: 1,
  commands: [
    { name: 'get_file_contents', effect: 'read', mcp: 'get_file_contents' },
    { name: 'create_or_update_file', effect: 'write', mcp: 'create_or_update_file', verify: { command: 'get_file_contents', expect: { content: 'content' } } },
    { name: 'get_pull_request', effect: 'read', mcp: 'get_pull_request' },
    { name: 'create_pull_request', effect: 'write', mcp: 'create_pull_request', verify: { command: 'get_pull_request', expect: { head: 'head', base: 'base' } } },
    { name: 'plain_write', effect: 'write', mcp: 'plain_write' },
  ],
};

function githubTool(manifest: unknown, commandName: string, session: unknown) {
  const parsed = cm.parseManifest(manifest).manifest;
  const command = parsed.commands.find((c: Cmd) => c.name === commandName);
  return {
    integration: { id: 'int-gh', preset: 'github', kind: 'mcp', name: 'GitHub', description: null, endpoint: 'https://api.githubcopilot.com/mcp/', auth_type: 'oauth', auth_header: null, delegation: 'approve_each' },
    remote: { name: command.mcp, description: '', inputSchema: {}, readOnly: command.effect === 'read' },
    command, manifest: parsed, session,
  };
}

const sessionWith = (handlers: Record<string, (args: Record<string, unknown>) => { text: string; isError: boolean }>) => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
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

describe('capturePlanExpected — the plan-time half performs zero writes', () => {
  it('captures the expectation and the pre-state baseline, reading only', async () => {
    const { session, calls } = sessionWith({
      get_file_contents: () => ({ text: '# Old\n', isError: false }),
      create_or_update_file: () => ({ text: 'MUST NOT RUN', isError: false }),
    });
    const tool = githubTool(GH_MANIFEST, 'create_or_update_file', session);
    const expected = await pm.capturePlanExpected(tool, writeFile('p1'));
    expect(expected).toEqual({
      verifyCommand: 'get_file_contents',
      expected: { content: '# Smoke\n' },
      baseline: { values: { content: '# Old\n' }, absent: [] },
    });
    // The write command was never invoked: capturing a plan is reads only.
    expect(calls.map((c) => c.name)).toEqual(['get_file_contents']);
  });

  it('a write with no verify declaration has no expected effect', async () => {
    const { session } = sessionWith({});
    const tool = githubTool(GH_MANIFEST, 'plain_write', session);
    expect(await pm.capturePlanExpected(tool, { id: 'p1', name: 'gh__plain_write', input: {} })).toBeNull();
  });

  it('a verify read that cannot be addressed before the write leaves the baseline honestly absent', async () => {
    // get_pull_request needs the created PR's number: the stub refuses
    // without it, exactly as the real read would.
    const { session } = sessionWith({
      get_pull_request: (args) => (args.pullNumber === undefined
        ? { text: 'pullNumber is required', isError: true }
        : { text: '{"head":"b","base":"main"}', isError: false }),
    });
    const tool = githubTool(GH_MANIFEST, 'create_pull_request', session);
    const call: Call = { id: 'p1', name: 'gh__create_pull_request', input: { owner: 'noajp', repo: 'Clayware', head: 'b', base: 'main', title: 't' } };
    const expected = await pm.capturePlanExpected(tool, call);
    expect(expected?.verifyCommand).toBe('get_pull_request');
    expect(expected?.expected).toEqual({ head: 'b', base: 'main' });
    expect(expected?.baseline).toBeNull();
  });
});

describe('checkPlanDrift — the apply-time premise re-check', () => {
  const planTime = {
    verifyCommand: 'get_file_contents',
    expected: { content: '# Smoke\n' },
    baseline: { values: { content: '# Old\n' }, absent: [] as string[] },
  };

  it('stands when the pre-state is unchanged', async () => {
    const { session } = sessionWith({ get_file_contents: () => ({ text: '# Old\n', isError: false }) });
    const tool = githubTool(GH_MANIFEST, 'create_or_update_file', session);
    expect(await pm.checkPlanDrift(tool, writeFile('a1'), planTime)).toEqual([]);
  });

  it('fails closed with the diff when the pre-state moved since the plan', async () => {
    const { session } = sessionWith({ get_file_contents: () => ({ text: '# Someone else\n', isError: false }) });
    const tool = githubTool(GH_MANIFEST, 'create_or_update_file', session);
    expect(await pm.checkPlanDrift(tool, writeFile('a1'), planTime))
      .toEqual([{ field: 'content', expected: '# Old\n', actual: '# Someone else\n' }]);
  });

  it('fails closed when the pre-state can no longer be read at all', async () => {
    const { session } = sessionWith({ get_file_contents: () => ({ text: 'HTTP 503', isError: true }) });
    const tool = githubTool(GH_MANIFEST, 'create_or_update_file', session);
    const drift = await pm.checkPlanDrift(tool, writeFile('a1'), planTime);
    expect(drift).toHaveLength(1);
    expect(drift?.[0].actual).toBe('読み戻しに失敗');
  });

  it('no baseline means no drift check — null, not an invented pass', async () => {
    const { session, calls } = sessionWith({});
    const tool = githubTool(GH_MANIFEST, 'create_or_update_file', session);
    expect(await pm.checkPlanDrift(tool, writeFile('a1'), { ...planTime, baseline: null })).toBeNull();
    expect(calls).toEqual([]);
  });
});

// ── The per-call execution record ───────────────────────────────────────

describe('recordPlanApproval / settlePlanApproval', () => {
  const fakeAdmin = () => {
    const inserted: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const client = {
      from: (_table: string) => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'act-call-1' }, error: null }) }) };
        },
        update: (row: Record<string, unknown>) => {
          updated.push(row);
          return { eq: async () => ({ error: null }) };
        },
      }),
    };
    return { inserted, updated, client };
  };

  it('writes the policy-approval shape with decision_source plan, born approved, bound to the real call', async () => {
    const { inserted, client } = fakeAdmin();
    const call = writeFile('a1');
    const id = await pm.recordPlanApproval(client, {
      runId: 'run-apply', elementId: 'el-1', call, display,
      planActionId: 'act-plan', integrationId: 'int-gh', decidedBy: 'user-1',
    });
    expect(id).toBe('act-call-1');
    expect(inserted).toHaveLength(1);
    const row = inserted[0];
    expect(row.decision_source).toBe('plan');
    expect(row.status).toBe('approved');
    expect(row.decided_by).toBe('user-1');
    expect(row.input_hash).toBe(await oauth.sha256Hex(loop.canonicalCalls([call])));
    expect((row.input as { plan: { actionId: string } }).plan.actionId).toBe('act-plan');
    expect((row.input as { calls: Call[] }).calls[0].id).toBe('a1');
  });

  it('settles executed / failed, carrying the verify check or the refusing drift', async () => {
    const { updated, client } = fakeAdmin();
    await pm.settlePlanApproval(client, 'act-call-1', true, { verify: { ok: true } });
    expect(updated[0]).toMatchObject({ status: 'executed', result: { failed: 0, total: 1, verify: { ok: true } } });
    await pm.settlePlanApproval(client, 'act-call-1', false, { drift: [{ field: 'content', expected: 'A', actual: 'B' }] });
    expect(updated[1]).toMatchObject({ status: 'failed', result: { failed: 1, total: 1, drift: [{ field: 'content', expected: 'A', actual: 'B' }] } });
  });
});

describe('approvalCountsOf — a plan counts once as the person’s decision', () => {
  it('the plan unit is asked/approved; its covered executions are policy-class', () => {
    const counts = oc.approvalCountsOf([
      { status: 'approved', decision_source: null },
      { status: 'executed', decision_source: 'plan' },
      { status: 'executed', decision_source: 'plan' },
      { status: 'executed', decision_source: 'policy' },
    ]);
    expect(counts).toEqual({ approvals_asked: 1, approvals_approved: 1, approvals_rejected: 0, approvals_policy: 3 });
  });
});

describe('the notices', () => {
  it('the plan-run notice says writes are recorded, not executed', () => {
    expect(pm.PLAN_TASK_NOTICE).toContain('計画モード');
    expect(pm.PLAN_TASK_NOTICE).toContain('実行せず');
  });

  it('the apply notice lists the approved sequence in order', async () => {
    const plan = await planOf([writeFile('p1'), writeFile('p2', '# Two\n')]);
    const notice = pm.planApplyNotice(plan);
    expect(notice).toContain('承認済みの計画の「適用」');
    expect(notice).toContain('1. GitHub: create_or_update_file');
    expect(notice).toContain('2. GitHub: create_or_update_file');
  });
});
