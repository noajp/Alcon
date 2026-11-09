import { describe, expect, it } from 'vitest';

// Definition tests (B14), the DB shells (_shared/definitionTests.ts):
// capture from a finished run's record, launch on the source run's
// Object, settle onto the row — against an in-memory fake of the
// supabase client, the repo's established pattern for _shared shells.
const dt = await import(new URL('../../supabase/functions/_shared/definitionTests.ts', import.meta.url).pathname);
const it_ = await import(new URL('../../supabase/functions/_shared/integrationTools.ts', import.meta.url).pathname);

type Row = Record<string, unknown>;

function makeFake(seed: Record<string, Row[]>) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  let gen = 0;
  function from(table: string) {
    const rows = store.get(table) ?? [];
    if (!store.has(table)) store.set(table, rows);
    const filters: ((r: Row) => boolean)[] = [];
    let op: { kind: 'insert' | 'update'; row: Row } | null = null;
    let limitN: number | null = null;
    const exec = (): Row[] => {
      if (op?.kind === 'insert') {
        const row = { id: `gen-${table}-${++gen}`, ...op.row };
        rows.push(row);
        return [row];
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op?.kind === 'update') {
        for (const r of hit) Object.assign(r, op.row);
        return hit;
      }
      return limitN != null ? hit.slice(0, limitN) : hit;
    };
    const q: Record<string, unknown> = {
      select: () => q,
      insert: (row: Row) => { op = { kind: 'insert', row }; return q; },
      update: (row: Row) => { op = { kind: 'update', row }; return q; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      in: (k: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[k])); return q; },
      not: (k: string, _o: string, v: unknown) => { filters.push((r) => r[k] !== v && r[k] != null); return q; },
      like: (k: string, pat: string) => {
        const prefix = pat.replace(/%$/, '');
        filters.push((r) => String(r[k] ?? '').startsWith(prefix));
        return q;
      },
      limit: (n: number) => { limitN = n; return q; },
      order: () => q,
      maybeSingle: async () => ({ data: exec()[0] ?? null, error: null }),
      single: async () => {
        const [row] = exec();
        return row ? { data: row, error: null } : { data: null, error: { message: 'no rows' } };
      },
      then: (res: (v: { data: Row[]; error: null }) => unknown) => res({ data: exec(), error: null }),
    };
    return q;
  }
  return { from, store };
}

const SPACE = 'space-1';
const USER = 'user-1';
const DEF = 'def-1';
const GMAIL = 'aaaa1111-0000-0000-0000-000000000001';
const SLACK = 'bbbb2222-0000-0000-0000-000000000002';
const gmailTool = (n: string) => `${it_.integrationPrefix('Gmail', GMAIL)}__${n}`;
const slackTool = (n: string) => `${it_.integrationPrefix('Slack', SLACK)}__${n}`;

const MANIFEST = (commands: Row[]) => ({
  version: 1,
  // A manifest command declares its transport (http mapping or an
  // mcp remote) — parseManifest drops one without it, as it should:
  // a command that cannot be called is not a command.
  commands: commands.map((c) => (c.http || c.mcp ? c : {
    ...c, http: { method: c.effect === 'write' ? 'POST' : 'GET', path: '/x' },
  })),
});

function world() {
  const transcript = {
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: gmailTool('list_messages'), input: { max: 5 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '3 messages' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c2', name: slackTool('post_message'), input: { channel: 'C1', text: '共有します' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c2', content: 'posted' }] },
      // A bookkeeping call rides along: not an integration exchange.
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c3', name: 'logProgress', input: { note: 'x' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c3', content: 'ok' }] },
    ],
  };
  return makeFake({
    agent_runs: [{
      id: 'run-1', status: 'completed', element_id: 'el-1', activity_space_id: SPACE,
      transcript, finish_detail: null, finished_at: '2026-11-08T10:00:00Z',
      model: 'claude-x', step_count: 4, triggered_by: USER,
    }],
    elements: [{ id: 'el-1', definition_id: DEF, object_id: 'obj-1', title: '朝の仕分け' }],
    definitions: [{ id: DEF, name: '問い合わせ仕分け', body: '# 目的\n仕分ける', enabled: true }],
    strategies: [],
    strategy_objects: [],
    integrations: [
      {
        id: GMAIL, name: 'Gmail', preset: 'gmail', kind: 'http', auth_type: 'token', endpoint: 'https://gmail.example',
        activity_space_id: SPACE,
        manifest: MANIFEST([{ name: 'list_messages', action: 'messages.list', effect: 'read', description: '一覧', input: {}, required: [] }]),
      },
      {
        id: SLACK, name: 'Slack', preset: 'slack', kind: 'http', auth_type: 'token', endpoint: 'https://slack.example',
        activity_space_id: SPACE,
        manifest: MANIFEST([{ name: 'post_message', action: 'chat.post', effect: 'write', description: '投稿', input: {}, required: [] }]),
      },
    ],
    integration_call_log: [
      { run_id: 'run-1', command_name: 'list_messages', is_write: false },
      { run_id: 'run-1', command_name: 'post_message', is_write: true },
    ],
    agent_run_steps: [],
    definition_tests: [],
    objects: [{ id: 'obj-1', domain_id: 'dom-1' }],
    workers: [{ id: 'w-1', name: 'Claude', type: 'ai_agent', status: 'active', ai_config: {}, activity_space_id: SPACE }],
    element_assignees: [],
    notifications: [],
  });
}

describe('capture', () => {
  it('previews the exchanges and saves the confirmed fixture through the member session', async () => {
    const fake = world();
    const preview = await dt.previewDefinitionTestCapture(fake, fake, 'run-1');
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.definitionId).toBe(DEF);
    expect(preview.tainted).toBe(false);
    expect(preview.sourceRunLabel).toContain('朝の仕分け');
    expect(preview.exchanges.map((e: { action: string }) => e.action)).toEqual(['messages.list', 'chat.post']);
    expect(preview.exchanges[0].argKeys).toEqual(['max']);

    const saved = await dt.saveDefinitionTestCapture(fake, fake, {
      runId: 'run-1', name: '朝の仕分けの再現', marks: new Map(), userId: USER,
    });
    expect(saved.ok).toBe(true);
    const rows = fake.store.get('definition_tests') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ definition_id: DEF, captured_by: USER, source_run_id: 'run-1', source_run_status: 'completed' });
    const fixture = dt.parseFixture(rows[0].fixture);
    expect(fixture?.exchanges).toHaveLength(2);
    expect(dt.parseFixtureExpected(rows[0].expected)?.classification).toBe('tested');
  });

  it('refuses a run that has not finished, and one that ran under a transcript-carried draft', async () => {
    const fake = world();
    fake.store.get('agent_runs')![0].status = 'running';
    expect(await dt.previewDefinitionTestCapture(fake, fake, 'run-1'))
      .toMatchObject({ ok: false, reason: 'run_not_finished' });
    fake.store.get('agent_runs')![0].status = 'completed';
    (fake.store.get('agent_runs')![0].transcript as Row).rehearsalDefinition = { name: 'x', body: 'y' };
    expect(await dt.previewDefinitionTestCapture(fake, fake, 'run-1'))
      .toMatchObject({ ok: false, reason: 'transcript_definition' });
  });

  it('fails whole on an unresolvable exchange and on a scrub hit — and saves nothing', async () => {
    const fake = world();
    const messages = (fake.store.get('agent_runs')![0].transcript as { messages: Row[] }).messages;
    messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: 'c9', name: 'gone_zz99__read', input: {} }] });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c9', content: 'x' }] });
    expect(await dt.previewDefinitionTestCapture(fake, fake, 'run-1'))
      .toMatchObject({ ok: false, reason: 'unresolvable', detail: 'gone_zz99__read' });

    const fake2 = world();
    const m2 = (fake2.store.get('agent_runs')![0].transcript as { messages: Row[] }).messages;
    (m2[1].content as Row[])[0].content = `ghp_${'A'.repeat(36)}`;
    const hit = await dt.saveDefinitionTestCapture(fake2, fake2, {
      runId: 'run-1', name: 'x', marks: new Map(), userId: USER,
    });
    expect(hit).toMatchObject({ ok: false, reason: 'scrub', detail: 'github-token', seq: 1 });
    expect(fake2.store.get('definition_tests')).toHaveLength(0);
  });

  it('marks the fixture tainted when the source run read the web (B6 rule), without refusing', async () => {
    const fake = world();
    fake.store.set('agent_run_steps', [{ id: 's1', run_id: 'run-1', title: 'Web 検索: 天気' }]);
    const preview = await dt.previewDefinitionTestCapture(fake, fake, 'run-1');
    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.tainted).toBe(true);
  });
});

describe('launch and settle', () => {
  async function launched() {
    const fake = world();
    const saved = await dt.saveDefinitionTestCapture(fake, fake, {
      runId: 'run-1', name: '朝の仕分けの再現', marks: new Map(), userId: USER,
    });
    if (!saved.ok) throw new Error('save failed');
    const started: string[] = [];
    const launchedRun = await dt.launchDefinitionTest({
      admin: fake, userDb: fake, userId: USER, testId: saved.testId,
      startRun: async (id: string) => { started.push(id); },
    });
    if (!launchedRun.ok) throw new Error(`launch failed: ${JSON.stringify(launchedRun)}`);
    return { fake, testId: saved.testId, launchedRun, started };
  }

  it('launches a rehearsal run carrying the fixture REFERENCE on the source Object', async () => {
    const { fake, testId, launchedRun, started } = await launched();
    expect(started).toEqual([launchedRun.runId]);
    const run = fake.store.get('agent_runs')!.find((r) => r.id === launchedRun.runId)!;
    expect(run).toMatchObject({ rehearsal: true, triggered_from: 'definition-test', triggered_by: USER, status: 'queued' });
    const transcript = run.transcript as Row;
    expect(transcript.testFixture).toEqual({ testId, definitionId: DEF });
    expect((transcript.rehearsalDefinition as Row).body).toBe('# 目的\n仕分ける');
    // The fixture body itself is NOT in the transcript.
    expect(JSON.stringify(transcript)).not.toContain('3 messages');
    const el = fake.store.get('elements')!.find((r) => r.id === launchedRun.elementId)!;
    expect(el.object_id).toBe('obj-1');
    expect(el.labels).toEqual(['rehearsal', 'definition-test']);
    const test = fake.store.get('definition_tests')![0];
    expect(test.last_run_id).toBe(launchedRun.runId);
  });

  it('settles the finished run: verdict on the row, one step, one notification to the launcher', async () => {
    const { fake, testId, launchedRun } = await launched();
    const run = fake.store.get('agent_runs')!.find((r) => r.id === launchedRun.runId)!;
    const test = fake.store.get('definition_tests')!.find((r) => r.id === testId)!;
    const fixture = dt.parseFixture(test.fixture);
    run.status = 'completed';
    run.finished_at = '2026-11-09T01:00:00Z';
    run.transcript = {
      ...(run.transcript as Row),
      rehearsal: {
        reads: [{ tool: 'messages.list', ok: true, authFailure: false }],
        writes: [{ tool: 'chat.post', valid: true, problem: null }],
      },
      test: {
        divergences: [], divergenceOverflow: 0,
        consumed: fixture.exchanges.length, total: fixture.exchanges.length,
        repeats: 0, consumedSeqs: fixture.exchanges.map((e: { seq: number }) => e.seq),
      },
    };
    const settled = await dt.settleDefinitionTest(fake, test);
    expect(settled).toEqual({ settled: true });
    const after = fake.store.get('definition_tests')![0];
    const verdict = dt.parseTestVerdict(after.last_result);
    expect(verdict?.outcome).toBe('pass');
    expect(after.last_body_hash).toBe(await dt.definitionBodyHash('# 目的\n仕分ける'));
    expect(fake.store.get('agent_run_steps')!.filter((s) => s.run_id === launchedRun.runId)).toHaveLength(1);
    const notes = fake.store.get('notifications')!;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ recipient_id: USER, kind: 'definition_test', definition_test_id: testId });
    // Idempotent: a second settle writes nothing again.
    const again = await dt.settleDefinitionTest(fake, fake.store.get('definition_tests')![0]);
    expect(again).toEqual({ settled: true });
    expect(fake.store.get('agent_run_steps')!.filter((s) => s.run_id === launchedRun.runId)).toHaveLength(1);
    expect(fake.store.get('notifications')).toHaveLength(1);
  });

  it('a body override binds the result to the EDITED body hash (D6)', async () => {
    const fake = world();
    const saved = await dt.saveDefinitionTestCapture(fake, fake, {
      runId: 'run-1', name: 'x', marks: new Map(), userId: USER,
    });
    if (!saved.ok) throw new Error('save failed');
    const out = await dt.launchDefinitionTest({
      admin: fake, userDb: fake, userId: USER, testId: saved.testId,
      bodyOverride: '# 目的\n編集した本文', startRun: async () => {},
    });
    if (!out.ok) throw new Error('launch failed');
    const run = fake.store.get('agent_runs')!.find((r) => r.id === out.runId)!;
    expect(((run.transcript as Row).rehearsalDefinition as Row).body).toBe('# 目的\n編集した本文');
  });
});
