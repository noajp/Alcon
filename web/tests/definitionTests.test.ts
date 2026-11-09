import { describe, expect, it } from 'vitest';

// Definition tests (B14), the pure core (_shared/definitionTests.ts):
// a fixture cut from a real run's transcript, the expectation derived
// from it, and the replay transport that answers from the record.
// The acceptance numbers refer to the design's §12.
const dt = await import(new URL('../../supabase/functions/_shared/definitionTests.ts', import.meta.url).pathname);
const fp = await import(new URL('../../supabase/functions/_shared/failurePolicy.ts', import.meta.url).pathname);
const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);
const itools = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname);
const cmanifest = await import(new URL('../../supabase/functions/_shared/connectorManifest.ts', import.meta.url).pathname);

type Call = { id: string; name: string; input: Record<string, unknown>; result: string; isError?: boolean };

const transcriptOf = (calls: Call[]) => ({
  messages: [
    ...calls.map((c) => ({
      role: 'assistant',
      content: [{ type: 'tool_use', id: c.id, name: c.name, input: c.input }],
    })),
    ...calls.map((c) => ({
      role: 'user',
      content: [{
        type: 'tool_result', tool_use_id: c.id, content: c.result,
        ...(c.isError ? { is_error: true } : {}),
      }],
    })),
  ],
});

const RESOLUTIONS: Record<string, { action: string; kind: 'read' | 'write'; integrationName: string; summary: string }> = {
  gmail_ab12__list_messages: { action: 'list_messages', kind: 'read', integrationName: 'Gmail', summary: 'Gmail: list_messages' },
  gmail_ab12__get_message: { action: 'get_message', kind: 'read', integrationName: 'Gmail', summary: 'Gmail: get_message' },
  slack_cd34__post_message: { action: 'post_message', kind: 'write', integrationName: 'Slack', summary: 'Slack: post_message' },
};
const resolve = (call: { toolName: string }) => RESOLUTIONS[call.toolName] ?? null;

const BASE_CALLS: Call[] = [
  { id: 'c1', name: 'gmail_ab12__list_messages', input: { max: 5 }, result: '3 messages' },
  { id: 'c2', name: 'gmail_ab12__get_message', input: { id: 'm1' }, result: '本文です' },
  { id: 'c3', name: 'slack_cd34__post_message', input: { channel: 'C1', text: '共有します' }, result: 'posted' },
];

async function fixtureOf(calls: Call[] = BASE_CALLS, marks?: Map<number, string[]>) {
  const extracted = dt.extractCalls(transcriptOf(calls));
  const built = await dt.buildFixture(extracted, resolve);
  if (!built.ok) throw new Error(`build failed: ${JSON.stringify(built)}`);
  let fixture = built.fixture;
  if (marks) fixture = await dt.applyVolatileMarks(fixture, marks);
  const scrubbed = dt.scrubFixture(fixture);
  if (!scrubbed.ok) throw new Error('scrub failed');
  return scrubbed.fixture;
}

describe('extraction and build', () => {
  it('pairs tool_use with tool_result and keeps only the resolved exchanges', async () => {
    const extracted = dt.extractCalls(transcriptOf(BASE_CALLS));
    expect(extracted).toHaveLength(3);
    expect(extracted[0]).toMatchObject({ toolName: 'gmail_ab12__list_messages', response: { text: '3 messages', isError: false } });
    const fixture = await fixtureOf();
    expect(fixture.exchanges.map((e: { action: string }) => e.action)).toEqual(['list_messages', 'get_message', 'post_message']);
    expect(fixture.exchanges[2].kind).toBe('write');
    expect(fixture.exchanges[0].argHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('§12.5: an unresolvable call fails the whole capture, naming the call', async () => {
    const calls = [...BASE_CALLS, { id: 'c9', name: 'gone_ef56__whatever', input: {}, result: 'x' }];
    const built = await dt.buildFixture(dt.extractCalls(transcriptOf(calls)), resolve);
    expect(built).toEqual({ ok: false, reason: 'unresolvable', toolName: 'gone_ef56__whatever' });
  });

  it('§12.6: over the exchange ceiling the capture fails naming the limit', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      id: `c${i}`, name: 'gmail_ab12__list_messages', input: { max: i }, result: 'ok',
    }));
    const built = await dt.buildFixture(dt.extractCalls(transcriptOf(many)), resolve);
    expect(built).toEqual({ ok: false, reason: 'limit', detail: 'count' });
  });

  it('§12.6: a fixture over the size ceiling is refused', async () => {
    const big = await fixtureOf([{ id: 'c1', name: 'gmail_ab12__list_messages', input: {}, result: 'x'.repeat(1_100_000) }]);
    expect(dt.fixtureWithinSizeLimit(big)).toBe(false);
    expect(dt.fixtureWithinSizeLimit(await fixtureOf())).toBe(true);
  });

  it('parseFixture is versioned and fail-closed', async () => {
    const fixture = await fixtureOf();
    expect(dt.parseFixture(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
    expect(dt.parseFixture({ ...fixture, v: 2 })).toBeNull();
    expect(dt.parseFixture(null)).toBeNull();
    const broken = JSON.parse(JSON.stringify(fixture));
    broken.exchanges[1].seq = 99;
    expect(dt.parseFixture(broken)).toBeNull();
    const badHash = JSON.parse(JSON.stringify(fixture));
    badHash.exchanges[0].argHash = 'not-a-hash';
    expect(dt.parseFixture(badHash)).toBeNull();
  });
});

describe('the scrub (§3 layer 2)', () => {
  it('§12.4: credential-shaped strings fail capture with pattern + seq only — the excerpt reaches nothing', async () => {
    const token = `ghp_${'A'.repeat(36)}`;
    const calls = [
      BASE_CALLS[0],
      { id: 'c2', name: 'gmail_ab12__get_message', input: { id: 'm1' }, result: `token は ${token} です` },
    ];
    const built = await dt.buildFixture(dt.extractCalls(transcriptOf(calls)), resolve);
    if (!built.ok) throw new Error('build failed');
    const scrubbed = dt.scrubFixture(built.fixture);
    expect(scrubbed.ok).toBe(false);
    if (!scrubbed.ok) {
      expect(scrubbed.pattern).toBe('github-token');
      expect(scrubbed.seq).toBe(2);
      // The whole failure value carries the pattern name and the seq
      // and nothing of the secret itself.
      expect(JSON.stringify(scrubbed)).not.toContain(token);
      expect(JSON.stringify(scrubbed)).not.toContain('AAAA');
    }
  });

  it('§12.4: a credential shape inside ARGUMENTS fails the same way', async () => {
    const key = `sk-${'b'.repeat(30)}`;
    const calls = [{ id: 'c1', name: 'gmail_ab12__list_messages', input: { q: key }, result: 'ok' }];
    const built = await dt.buildFixture(dt.extractCalls(transcriptOf(calls)), resolve);
    if (!built.ok) throw new Error('build failed');
    const scrubbed = dt.scrubFixture(built.fixture);
    expect(scrubbed.ok).toBe(false);
    if (!scrubbed.ok) expect(JSON.stringify(scrubbed)).not.toContain(key);
  });
});

describe('expected derivation (§2.4)', () => {
  it('§12.1: the fixture of a clean run expects the tested classification and its write plans', async () => {
    const fixture = await fixtureOf();
    const expected = dt.expectedFromExchanges(fixture, 'completed');
    expect(expected.classification).toBe('tested');
    expect(expected.writePlans).toHaveLength(1);
    expect(expected.writePlans[0]).toMatchObject({ action: 'post_message', summary: 'Slack: post_message' });
    expect(dt.parseFixtureExpected(JSON.parse(JSON.stringify(expected)))).toEqual(expected);
  });

  it('§12.7: capture from a FAILED run folds the failure into the expectation', async () => {
    const fixture = await fixtureOf();
    expect(dt.expectedFromExchanges(fixture, 'failed').classification).toBe('read_failed');
  });

  it('a recorded auth failure expects the connector class', async () => {
    const calls = [{ id: 'c1', name: 'gmail_ab12__list_messages', input: {}, result: '401 Unauthorized: token expired', isError: true }];
    const fixture = await fixtureOf(calls);
    expect(dt.expectedFromExchanges(fixture, 'failed').classification).toBe('connector_missing');
  });
});

describe('the replay transport', () => {
  it('§12.1: replaying the recorded calls reproduces the pass', async () => {
    const fixture = await fixtureOf();
    const expected = dt.expectedFromExchanges(fixture, 'completed');
    const transport = new dt.ReplayTransport(fixture);
    const r1 = await transport.dispatch('list_messages', { max: 5 });
    const r2 = await transport.dispatch('get_message', { id: 'm1' });
    expect(r1).toEqual({ text: '3 messages', isError: false, replayed: true });
    expect(r2.isError).toBe(false);
    expect(await transport.matchWrite('post_message', { channel: 'C1', text: '共有します' })).toEqual({ valid: true });
    const verdict = dt.judgeTestRun({
      fixture, expected,
      report: { reads: [{ tool: 'list_messages', ok: true, authFailure: false }, { tool: 'get_message', ok: true, authFailure: false }], writes: [{ tool: 'post_message', valid: true, problem: null }] },
      runFailed: false, state: transport.state(), bodyHash: 'h', model: 'm', at: new Date(),
    });
    expect(verdict.outcome).toBe('pass');
    expect(verdict.consumed).toBe(3);
    expect(verdict.writePlans).toEqual({ matched: 1, total: 1 });
    expect(dt.parseTestVerdict(JSON.parse(JSON.stringify(verdict)))).toEqual(verdict);
  });

  it('§12.8: same-turn calls dispatched out of order still match (consuming, not sequential)', async () => {
    const fixture = await fixtureOf();
    const transport = new dt.ReplayTransport(fixture);
    expect((await transport.dispatch('get_message', { id: 'm1' })).isError).toBe(false);
    expect((await transport.dispatch('list_messages', { max: 5 })).isError).toBe(false);
    expect(transport.state().consumed).toBe(2);
    expect(transport.state().divergences).toEqual([]);
  });

  it('§12.2: a call the record does not hold is an unexpected-call divergence, answered as an error', async () => {
    const fixture = await fixtureOf();
    const transport = new dt.ReplayTransport(fixture);
    const r = await transport.dispatch('delete_message', { id: 'm1' });
    expect(r.isError).toBe(true);
    expect(r.replayed).toBe(true);
    expect(transport.state().divergences).toEqual([{ kind: 'unexpected-call', action: 'delete_message' }]);
  });

  it('§12.2: a planned write that differs is a write-divergence', async () => {
    const fixture = await fixtureOf();
    const transport = new dt.ReplayTransport(fixture);
    expect(await transport.matchWrite('post_message', { channel: 'C2', text: '共有します' })).toEqual({ valid: false });
    expect(transport.state().divergences).toEqual([{ kind: 'write-divergence', action: 'post_message' }]);
  });

  it('§12.9: same action, different arguments — argument-divergence with key NAMES only', async () => {
    const fixture = await fixtureOf();
    const transport = new dt.ReplayTransport(fixture);
    const r = await transport.dispatch('get_message', { id: 'SECRET-VALUE-m9' });
    expect(r.isError).toBe(true);
    const [d] = transport.state().divergences;
    expect(d.kind).toBe('argument-divergence');
    expect(d.differingKeys).toEqual(['id']);
    expect(d.expectedSeq).toBe(2);
    expect(JSON.stringify(d)).not.toContain('SECRET-VALUE-m9');
  });

  it('§12.10: repeating a spent success diverges; leftovers settle as incomplete', async () => {
    const fixture = await fixtureOf();
    const expected = dt.expectedFromExchanges(fixture, 'completed');
    const transport = new dt.ReplayTransport(fixture);
    await transport.dispatch('list_messages', { max: 5 });
    const again = await transport.dispatch('list_messages', { max: 5 });
    expect(again.isError).toBe(true);
    expect(transport.state().divergences.map((d: { kind: string }) => d.kind)).toEqual(['repeat-of-success']);
    const verdict = dt.judgeTestRun({
      fixture, expected,
      report: { reads: [{ tool: 'list_messages', ok: true, authFailure: false }], writes: [] },
      runFailed: false, state: transport.state(), bodyHash: 'h', model: 'm', at: new Date(),
    });
    expect(verdict.outcome).toBe('fail');
    const incomplete = verdict.divergences.find((d: { kind: string }) => d.kind === 'incomplete');
    expect(incomplete?.remainingActions).toEqual(['get_message', 'post_message']);
  });

  it('§12.11: the first divergence seals the fail — a clean recovery never returns to pass', async () => {
    const fixture = await fixtureOf();
    const expected = dt.expectedFromExchanges(fixture, 'completed');
    const transport = new dt.ReplayTransport(fixture);
    await transport.dispatch('delete_message', { id: 'x' }); // diverges first
    await transport.dispatch('list_messages', { max: 5 });
    await transport.dispatch('get_message', { id: 'm1' });
    await transport.matchWrite('post_message', { channel: 'C1', text: '共有します' });
    const verdict = dt.judgeTestRun({
      fixture, expected,
      report: { reads: [{ tool: 'list_messages', ok: true, authFailure: false }, { tool: 'get_message', ok: true, authFailure: false }], writes: [{ tool: 'post_message', valid: true, problem: null }] },
      runFailed: false, state: transport.state(), bodyHash: 'h', model: 'm', at: new Date(),
    });
    expect(verdict.outcome).toBe('fail');
    expect(verdict.divergences[0].kind).toBe('unexpected-call');
    expect(verdict.consumed).toBe(3); // recovery really happened — and still fails
  });

  it('§12.12: volatile-marked keys drop out of the hash; unmarked changes still diverge', async () => {
    const calls = [
      { id: 'c1', name: 'gmail_ab12__list_messages', input: { max: 5, ts: '2026-11-09T00:00:00Z' }, result: '3 messages' },
    ];
    const fixture = await fixtureOf(calls, new Map([[1, ['ts']]]));
    expect(fixture.exchanges[0].volatile).toEqual(['ts']);
    const transport = new dt.ReplayTransport(fixture);
    const ok = await transport.dispatch('list_messages', { max: 5, ts: '2027-01-01T00:00:00Z' });
    expect(ok.isError).toBe(false);
    const fixture2 = await fixtureOf(calls, new Map([[1, ['ts']]]));
    const transport2 = new dt.ReplayTransport(fixture2);
    const bad = await transport2.dispatch('list_messages', { max: 6, ts: '2026-11-09T00:00:00Z' });
    expect(bad.isError).toBe(true);
    expect(transport2.state().divergences[0]).toMatchObject({ kind: 'argument-divergence', differingKeys: ['max'] });
  });

  it('§12.13: a recorded final failure replays stickily — re-dispatch counts, consumption does not move', async () => {
    const calls = [
      { id: 'c1', name: 'gmail_ab12__list_messages', input: { max: 5 }, result: '503 Service Unavailable', isError: true },
    ];
    const fixture = await fixtureOf(calls);
    const transport = new dt.ReplayTransport(fixture);
    const first = await transport.dispatch('list_messages', { max: 5 });
    expect(first).toEqual({ text: '503 Service Unavailable', isError: true, replayed: true });
    // The definition's failure row retries the read: the same error
    // comes back from the record, counted as a repeat.
    for (let i = 0; i < 2; i++) {
      const again = await transport.dispatch('list_messages', { max: 5 });
      expect(again.text).toBe('503 Service Unavailable');
      expect(again.isError).toBe(true);
    }
    expect(transport.state().repeats).toBe(2);
    expect(transport.state().consumed).toBe(1);
    expect(transport.state().divergences).toEqual([]);
    // And the failure policy above the transport still resolves the
    // retry the definition declares — the loop the sticky replay feeds.
    const parsed = def.parseDefinition('# 目的\nx\n# 失敗時の扱い\n- unavailable: 再試行 2回、エスカレーション: オーナー、3回で諦める');
    const policy = fp.resolveFailurePolicy({ class: 'unavailable', definition: parsed, entries: [] });
    expect(policy.retry).toBe(2);
    expect(policy.giveUpAfter).toBe(3);
  });

  it('a successful exchange list never turns sticky', async () => {
    const fixture = await fixtureOf();
    const transport = new dt.ReplayTransport(fixture);
    await transport.dispatch('list_messages', { max: 5 });
    const again = await transport.dispatch('list_messages', { max: 5 });
    expect(again.isError).toBe(true); // repeat-of-success error, not the recorded success
    expect(again.text).not.toBe('3 messages');
    expect(transport.state().repeats).toBe(0);
  });

  it('state restores into a fresh transport (the continuation rebuild)', async () => {
    const fixture = await fixtureOf();
    const first = new dt.ReplayTransport(fixture);
    await first.dispatch('list_messages', { max: 5 });
    const restored = new dt.ReplayTransport(fixture, first.state());
    expect(restored.state().consumedSeqs).toEqual([1]);
    expect((await restored.dispatch('get_message', { id: 'm1' })).isError).toBe(false);
    expect(restored.remaining().map((e: { action: string }) => e.action)).toEqual(['post_message']);
  });

  it('the classification conjunct: a replay measuring a different class fails even when fully consumed', async () => {
    const fixture = await fixtureOf();
    const expected = dt.expectedFromExchanges(fixture, 'completed');
    const transport = new dt.ReplayTransport(fixture);
    await transport.dispatch('list_messages', { max: 5 });
    await transport.dispatch('get_message', { id: 'm1' });
    await transport.matchWrite('post_message', { channel: 'C1', text: '共有します' });
    const verdict = dt.judgeTestRun({
      fixture, expected,
      // The test run's own report says a read failed (the model
      // treated the recorded text differently) — measured ≠ expected.
      report: { reads: [{ tool: 'list_messages', ok: false, authFailure: false }], writes: [{ tool: 'post_message', valid: true, problem: null }] },
      runFailed: false, state: transport.state(), bodyHash: 'h', model: 'm', at: new Date(),
    });
    expect(verdict.outcome).toBe('fail');
    expect(verdict.classification).toBe('read_failed');
    expect(verdict.expectedClassification).toBe('tested');
  });
});

describe('the executor seam (§4.1)', () => {
  const manifestOf = (extra: Record<string, unknown> = {}) => cmanifest.parseManifest({
    version: 1,
    commands: [{
      name: 'list_messages', action: 'list_messages', effect: 'read',
      description: '一覧', input: {}, required: [],
      http: { method: 'GET', path: '/messages' }, ...extra,
    }],
  }).manifest;

  const toolOf = (transport: unknown, bind: () => Promise<unknown>, manifest = manifestOf()) => ({
    integration: { id: 'int-1', name: 'Gmail', endpoint: 'https://gmail.example', kind: 'http' },
    remote: null,
    command: manifest.commands[0],
    manifest,
    bind,
    replay: transport,
  });

  it('§12.3/§12.14: a replayed call answers from the record — the binding is resolved ZERO times', async () => {
    const fixture = await fixtureOf();
    const transport = new dt.ReplayTransport(fixture);
    let binds = 0;
    const bind = async () => { binds++; return { secret: 'should-never-be-read', session: null }; };
    const tool = toolOf(transport, bind);
    const r = await itools.executeIntegrationTool(tool, { id: 'x1', name: 'gmail_ab12__list_messages', input: { max: 5 } });
    expect(r).toEqual({ text: '3 messages', isError: false, replayed: true });
    expect(binds).toBe(0);
    // The control: the same tool WITHOUT replay does resolve its
    // binding (here it throws, so nothing dispatches — the count is
    // the assertion).
    let liveBinds = 0;
    const liveTool = {
      ...tool, replay: undefined,
      bind: async () => { liveBinds++; throw new Error('no vault in tests'); },
    };
    await itools.executeIntegrationTool(liveTool, { id: 'x2', name: 'gmail_ab12__list_messages', input: { max: 5 } }).catch(() => {});
    expect(liveBinds).toBe(1);
  });

  it('§4.1: the manifest deny recheck stands BEFORE replay — a now-denied call is refused, not replayed', async () => {
    const fixture = await fixtureOf();
    const transport = new dt.ReplayTransport(fixture);
    const manifest = manifestOf({ rules: [{ when: { max: '5' }, permission: 'deny' }] });
    const tool = toolOf(transport, async () => ({ secret: null, session: null }), manifest);
    const r = await itools.executeIntegrationTool(tool, { id: 'x1', name: 'gmail_ab12__list_messages', input: { max: 5 } });
    expect(r.isError).toBe(true);
    expect(r.replayed).toBeUndefined();
    expect(r.text).toContain('許可されていません');
    expect(transport.state().consumed).toBe(0);
  });

  it('§4.2: the match key — canonical action, remote name, http pseudo-action', () => {
    const manifest = manifestOf();
    const base = { integration: { id: 'i', name: 'X', endpoint: 'https://x.example', kind: 'http' }, remote: null };
    expect(itools.replayActionFor({ ...base, command: manifest.commands[0], manifest }, { id: '1', name: 't', input: {} }))
      .toBe('list_messages');
    expect(itools.replayActionFor(
      { ...base, drive: true, remote: { name: 'drive_search', description: '', inputSchema: {}, readOnly: true } },
      { id: '1', name: 't', input: {} },
    )).toBe('drive_search');
    expect(itools.replayActionFor(base, { id: '1', name: 't', input: { method: 'post', url: 'https://api.example/v1/items?x=1' } }))
      .toBe('http_request:POST:/v1/items');
    // Capture computes the same pseudo-action from the same input.
    expect(dt.httpPseudoAction({ method: 'post', url: 'https://api.example/v1/items?x=1' }))
      .toBe('http_request:POST:/v1/items');
  });
});
