import { describe, expect, it } from 'vitest';

const cm = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);
const bk = await import(new URL('../../supabase/functions/_shared/breakers.ts', import.meta.url).pathname);
const loop = await import(new URL('../../supabase/functions/_shared/agentLoop.ts', import.meta.url).pathname);

// Circuit breakers + manifest quotas (back-half B11): the policy
// numbers stand in BREAKER_POLICY; the three rules are pure functions
// over settled call counts; a manifest quota is the write-rate rule
// with the command's own number; and the loop holds a tripped turn's
// writes before the approval gate is ever consulted — the pin that no
// mode, delegation, standing rule or track record can lift a trip.

const RAW = {
  version: 1,
  defaults: { read: 'allow', write: 'ask' },
  commands: [
    { name: 'get_file', action: 'files.get', effect: 'read', mcp: 'get_file_contents', input: { path: { type: 'string' } }, required: ['path'] },
    { name: 'create_issue', action: 'issues.create', effect: 'write',
      input: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } },
      required: ['owner', 'repo', 'title'], http: { method: 'POST', path: '/repos/{owner}/{repo}/issues', body: ['title', 'body'] } },
    { name: 'send_http', action: 'messages.send', effect: 'write',
      input: { to: { type: 'string' }, text: { type: 'string' } }, required: ['to', 'text'],
      http: { method: 'POST', path: '/messages', body: ['to', 'text'] } },
    { name: 'send_email', action: 'mail.send', effect: 'write', mcp: 'send_email',
      input: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'body'] },
    { name: 'update_file', action: 'files.update', effect: 'write', mcp: 'create_or_update_file',
      input: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, content: { type: 'string' } },
      required: ['owner', 'repo', 'path', 'content'] },
    { name: 'bulk_import', action: 'items.import', effect: 'write', mcp: 'bulk_import',
      quota: { writes_per_hour: 3 }, input: { path: { type: 'string' } }, required: ['path'] },
  ],
};

type Cmd = ReturnType<typeof cm.parseManifest>['manifest']['commands'][number];
const { manifest, errors } = cm.parseManifest(RAW);
const cmd = (name: string): Cmd => manifest.commands.find((c: Cmd) => c.name === name)!;

const facts = (command: Cmd, input: Record<string, unknown> = {}) => ({
  integrationId: 'int-1', integrationName: 'GitHub', command,
  targetKey: bk.targetKeyOf(command, input),
});
const counts = (over: Partial<{ sameTargetWrites: number; runRecentOk: boolean[]; priorSuccessfulWritesToTarget: number }> = {}) => ({
  sameTargetWrites: 0, runRecentOk: [] as boolean[], priorSuccessfulWritesToTarget: 0, ...over,
});

describe('manifest quota (B11)', () => {
  it('parses clean: no command carries a quota unless it declares one', () => {
    expect(errors).toEqual([]);
    expect(cmd('create_issue').quota).toBeNull();
    expect(cmd('bulk_import').quota).toEqual({ writesPerHour: 3 });
  });

  it('parseQuota reads absent as absent and a whole number as the limit', () => {
    expect(cm.parseQuota(undefined)).toBeUndefined();
    expect(cm.parseQuota({ writes_per_hour: 1 })).toEqual({ writesPerHour: 1 });
    expect(cm.parseQuota({ writes_per_hour: 100_000 })).toEqual({ writesPerHour: 100_000 });
  });

  it('a malformed quota is a parse error and the command is left out — never a silent no-limit', () => {
    for (const bad of [0, -2, 1.5, '3', Number.NaN, 100_001]) {
      expect(cm.parseQuota({ writes_per_hour: bad })).toBeNull();
      const raw = JSON.parse(JSON.stringify(RAW));
      raw.commands[1].quota = { writes_per_hour: bad };
      const parsed = cm.parseManifest(raw);
      expect(parsed.manifest.commands.some((c: Cmd) => c.name === 'create_issue')).toBe(false);
      expect(parsed.errors.some((e: string) => e.includes('create_issue') && e.includes('quota'))).toBe(true);
    }
    expect(cm.parseQuota(null)).toBeNull();
    expect(cm.parseQuota('fast')).toBeNull();
    expect(cm.parseQuota({})).toBeNull();
  });

  it('a connection-test rebuild keeps a person’s stored quota, like verify', () => {
    const existing = {
      version: 1, defaults: { read: 'allow', write: 'ask' },
      commands: [{ name: 'update_file', action: 'files.update', effect: 'write', mcp: 'create_or_update_file', quota: { writes_per_hour: 7 } }],
    };
    const rebuilt = cm.manifestFromTools([{ name: 'create_or_update_file', description: 'writes a file', readOnly: false }], existing);
    const kept = (rebuilt.commands as Record<string, unknown>[]).find((c) => c.mcp === 'create_or_update_file');
    expect(kept?.quota).toEqual({ writes_per_hour: 7 });
    const reparsed = cm.parseManifest(rebuilt);
    expect(reparsed.manifest.commands.find((c: Cmd) => c.name === 'update_file')?.quota).toEqual({ writesPerHour: 7 });
  });
});

describe('target keys (B11)', () => {
  it('an HTTP command keys on its resolved request line', () => {
    expect(bk.targetKeyOf(cmd('create_issue'), { owner: 'acme', repo: 'web', title: 't', body: 'b' }))
      .toBe('POST /repos/acme/web/issues');
  });

  it('an HTTP destination named in the body refines the key — recipients are different targets', () => {
    expect(bk.targetKeyOf(cmd('send_http'), { to: 'a@example.com', text: 'hi' })).toBe('POST /messages · to=a@example.com');
    expect(bk.targetKeyOf(cmd('send_http'), { to: 'b@example.com', text: 'hi' })).toBe('POST /messages · to=b@example.com');
  });

  it('an MCP command keys on its addressing arguments, never its content', () => {
    expect(bk.targetKeyOf(cmd('send_email'), { to: 'a@example.com', subject: 's', body: 'b' })).toBe('to=a@example.com');
    expect(bk.targetKeyOf(cmd('update_file'), { owner: 'acme', repo: 'web', path: 'README.md', content: 'x' }))
      .toBe('owner=acme, repo=web, path=README.md');
    // Same destination, different content and a different argument order: same key.
    expect(bk.targetKeyOf(cmd('update_file'), { content: 'y', path: 'README.md', repo: 'web', owner: 'acme' }))
      .toBe('owner=acme, repo=web, path=README.md');
  });

  it('a call with no addressing argument keys on its command alone', () => {
    expect(bk.targetKeyOf(cmd('bulk_import'), {})).toBe('bulk_import');
  });
});

describe('the three breakers, at their exact boundaries (B11)', () => {
  const issue = () => facts(cmd('create_issue'), { owner: 'acme', repo: 'web', title: 't' });

  it('(a) write rate: the 10th settled write stands, the next call trips — not one earlier', () => {
    expect(bk.evaluateBreakers(issue(), counts({ sameTargetWrites: 9 }))).toBeNull();
    const trip = bk.evaluateBreakers(issue(), counts({ sameTargetWrites: 10 }));
    expect(trip?.rule).toBe('write_rate');
    expect(trip?.evidence).toMatchObject({ sameTargetWrites: 10, limit: 10, source: 'default' });
    expect(trip?.reason).toContain('10 件');
    expect(trip?.reason).toContain('POST /repos/acme/web/issues');
  });

  it('(a) a manifest quota is enforced at its own number, not the default', () => {
    const bulk = () => facts(cmd('bulk_import'), { path: 'a.csv' });
    expect(bk.evaluateBreakers(bulk(), counts({ sameTargetWrites: 2 }))).toBeNull();
    const trip = bk.evaluateBreakers(bulk(), counts({ sameTargetWrites: 3 }));
    expect(trip?.rule).toBe('write_rate');
    expect(trip?.evidence).toMatchObject({ sameTargetWrites: 3, limit: 3, source: 'quota' });
    // And the quota does not borrow the default's headroom either way:
    // 9 settled writes would pass a quota of 3's rule only by tripping.
    expect(bk.evaluateBreakers(bulk(), counts({ sameTargetWrites: 9 }))?.rule).toBe('write_rate');
  });

  it('(b) error rate: silent below the minimum sample, trips at exactly half of the last 20', () => {
    // Nine settled calls, all failed: not yet a sample.
    expect(bk.evaluateBreakers(issue(), counts({ runRecentOk: Array(9).fill(false) }))).toBeNull();
    // Ten settled, four failed: below the rate.
    expect(bk.evaluateBreakers(issue(), counts({
      runRecentOk: [true, true, true, true, true, true, false, false, false, false],
    }))).toBeNull();
    // Ten settled, five failed: exactly 50% — trips.
    const trip = bk.evaluateBreakers(issue(), counts({
      runRecentOk: [true, true, true, true, true, false, false, false, false, false],
    }));
    expect(trip?.rule).toBe('error_rate');
    expect(trip?.evidence).toMatchObject({ sample: 10, errors: 5 });
    // The window is the LAST 20: older failures beyond it do not count.
    const recent20 = [...Array(12).fill(true), ...Array(8).fill(false)]; // newest first: 8/20 = 40%
    expect(bk.evaluateBreakers(issue(), counts({ runRecentOk: [...recent20, ...Array(10).fill(false)] }))).toBeNull();
    const recent20Half = [...Array(10).fill(true), ...Array(10).fill(false)];
    expect(bk.evaluateBreakers(issue(), counts({ runRecentOk: [...recent20Half, ...Array(10).fill(true)] }))?.rule).toBe('error_rate');
  });

  it('(c) a first destination pauses a send — and only a settled success to it clears the pause', () => {
    const mail = () => facts(cmd('send_email'), { to: 'new@example.com', body: 'b' });
    const trip = bk.evaluateBreakers(mail(), counts({ priorSuccessfulWritesToTarget: 0 }));
    expect(trip?.rule).toBe('first_destination');
    expect(trip?.reason).toContain('new@example.com');
    expect(bk.evaluateBreakers(mail(), counts({ priorSuccessfulWritesToTarget: 1 }))).toBeNull();
    // A non-send write to a brand-new target is not this rule's business.
    expect(bk.evaluateBreakers(issue(), counts({ priorSuccessfulWritesToTarget: 0 }))).toBeNull();
    // A read never trips it (a read carries no send class).
    expect(bk.evaluateBreakers(facts(cmd('get_file'), { path: 'x' }), counts())).toBeNull();
  });

  it('when several rules would trip, the first destination — the widest reach — is named', () => {
    const mail = () => facts(cmd('send_email'), { to: 'new@example.com', body: 'b' });
    const trip = bk.evaluateBreakers(mail(), counts({
      priorSuccessfulWritesToTarget: 0, sameTargetWrites: 99, runRecentOk: Array(20).fill(false),
    }));
    expect(trip?.rule).toBe('first_destination');
  });

  it('the policy numbers stand in the one named place the design promised', () => {
    expect(bk.BREAKER_POLICY.sameTargetWritesPerHour).toBe(10);
    expect(bk.BREAKER_POLICY.errorWindow).toBe(20);
    expect(bk.BREAKER_POLICY.errorMinSample).toBe(10);
    expect(bk.BREAKER_POLICY.errorRate).toBe(0.5);
    expect(bk.BREAKER_POLICY.windowMs).toBe(3_600_000);
  });
});

// ── The loop: a trip holds the turn before the gate is consulted ──────

type Block = Record<string, unknown>;
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): Block => ({ type: 'tool_use', id, name, input });
const textBlock = (t: string): Block => ({ type: 'text', text: t });

function scripted(turns: { content: Block[] }[]) {
  let i = 0;
  return {
    callModel: async () => {
      const t = turns[i++] ?? { content: [textBlock('done')] };
      return { content: t.content, stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

const KIND: Record<string, string> = { read_thing: 'read', send_email: 'write', update_thing: 'write', finish: 'finish' };
const fresh = () => ({ messages: [{ role: 'user', content: 'task' }] as never[], turns: 0, nudges: 0, revisions: 0 as number | undefined });
const limits = () => ({ maxTurnsThisCall: 10, maxTotalTurns: 50, deadline: Date.now() + 60_000 });

function loopDeps(model: ReturnType<typeof scripted>, over: Record<string, unknown> = {}) {
  const executed: string[] = [];
  const deps = {
    callModel: model.callModel,
    kindOf: (n: string) => KIND[n] ?? 'board',
    needsApproval: () => false,
    execute: async (c: { name: string }) => {
      executed.push(c.name);
      if (c.name === 'finish') return { content: 'ok', finish: { outcome: 'completed', summary: 's', message: 'm' } };
      return { content: `${c.name} ok` };
    },
    onUsage: async () => {},
    budgetExceeded: () => false,
    cancelled: async () => false,
    ...over,
  };
  return { deps, executed };
}

describe('the loop’s breaker hold (B11)', () => {
  const turn = () => ({
    content: [toolUse('r1', 'read_thing'), toolUse('w1', 'send_email', { to: 'x@example.com' }), toolUse('w2', 'update_thing')],
  });

  it('a trip holds every write of the turn and executes none — even when the gate would allow them all', async () => {
    // needsApproval answers false for everything: the composition of
    // free mode, full delegation, a standing rule and a track-record
    // grant all at once. The trip must still hold — it is not an ask.
    const consulted: string[] = [];
    const { deps, executed } = loopDeps(scripted([turn()]), {
      needsApproval: () => { consulted.push('gate'); return false; },
      breakerHold: async (c: { name: string }) => (c.name === 'send_email' ? { reason: '初めての宛先です' } : null),
    });
    const out = await loop.runLoop(fresh(), deps, limits());
    expect(out.kind).toBe('approval');
    if (out.kind !== 'approval') return;
    expect(out.breaker).toEqual({ call: expect.objectContaining({ id: 'w1' }), reason: '初めての宛先です' });
    expect(out.pending.calls.map((c: { id: string }) => c.id)).toEqual(['w1', 'w2']);
    // The turn's read ran; no write did — a tripped run performs no
    // further writes until a person answers.
    expect(executed).toEqual(['read_thing']);
    // And the approval gate was never consulted about the turn at all.
    expect(consulted).toEqual([]);
  });

  it('without a trip the gate decides as before, and allowed writes run', async () => {
    const { deps, executed } = loopDeps(scripted([turn(), { content: [toolUse('f1', 'finish')] }]), {
      breakerHold: async () => null,
    });
    const out = await loop.runLoop(fresh(), deps, limits());
    expect(out.kind).toBe('finished');
    expect(executed).toEqual(expect.arrayContaining(['read_thing', 'send_email', 'update_thing', 'finish']));
  });

  it('the breaker is consulted for write-kind calls only', async () => {
    const asked: string[] = [];
    const { deps } = loopDeps(scripted([turn(), { content: [toolUse('f1', 'finish')] }]), {
      breakerHold: async (c: { name: string }) => { asked.push(c.name); return null; },
    });
    await loop.runLoop(fresh(), deps, limits());
    expect(asked).toEqual(['send_email', 'update_thing']);
  });
});
