import { describe, expect, it } from 'vitest';
import type { Manifest, ManifestCommand } from '../../supabase/functions/_shared/connectorManifest';
import { parseFinishDetail as parseFinishDetailWeb } from '@/Function/audit/auditModel';
import { compensationMarkerOf } from '@/Function/shared/approvalCardModel';

const comp = await import(new URL('../../supabase/functions/_shared/compensation.ts', import.meta.url).pathname);
const finishClaims = await import(new URL('../../supabase/functions/_shared/finishClaims.ts', import.meta.url).pathname);
const {
  COMPENSATION_DEFAULT, buildCompensationReport, compensationSetOf, engineCompensationPolicy,
  loadCompensationReport, recordCompensationExecution, recordWriteCompensation,
  resolveUndoPayload, verifyStatusOf,
} = comp;

// ── Fixtures ───────────────────────────────────────────────────────

const cmd = (over: Partial<ManifestCommand> & { name: string }): ManifestCommand => ({
  action: over.name, effect: 'write', permission: 'allow', description: '',
  input: {}, required: [], http: null, mcp: null, rules: [], present: null,
  verify: null, reversibility: null, quota: null, undo: null, ...over,
});

const closeIssue = cmd({
  name: 'close_issue', input: { issue_number: { type: 'number' } }, required: ['issue_number'],
  reversibility: 'contained',
});
const createIssue = cmd({
  name: 'create_issue', input: { title: { type: 'string' } }, required: ['title'],
  reversibility: 'contained',
  undo: { command: 'close_issue', input: { issue_number: 'number' } },
});
const MANIFEST: Manifest = { commands: [createIssue, closeIssue], aliases: {} };

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'w1', seq: 1, run_id: 'r1', activity_space_id: 's1', element_id: 'e1',
  integration_id: 'i1', command_name: 'create_issue', tool_use_id: 't1',
  target_key: null, undo_command_name: 'close_issue', undo_input: { issue_number: 42 },
  unresolved: [], verify_status: null, kind: 'write', compensates_id: null,
  status: 'pending', status_reason: null,
  created_at: '2026-11-09T00:00:00Z', settled_at: null, ...over,
});

// ── A minimal fake admin over plain row stores ─────────────────────

type Row = Record<string, unknown>;
interface Store { write_compensations: Row[]; integration_call_log: Row[]; integrations: Row[]; agent_actions: Row[] }

const emptyStore = (): Store => ({
  write_compensations: [], integration_call_log: [], agent_actions: [],
  integrations: [{ id: 'i1', name: 'GitHub', manifest: { commands: [
    { name: 'create_issue', effect: 'write', reversibility: 'contained' },
    { name: 'close_issue', effect: 'write', reversibility: 'contained' },
    { name: 'delete_repo', effect: 'write', critical: true },
    { name: 'send_mail', effect: 'write' },
  ] } }],
});

function fakeAdmin(store: Store, failInserts = false) {
  let gen = 0;
  let seq = 0;
  const from = (table: keyof Store) => {
    const rows = store[table];
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row | null = null;
    const filters: { col: string; op: 'eq' | 'in'; val?: unknown }[] = [];
    const orders: { col: string; ascending: boolean }[] = [];
    const matchesRow = (r: Row) => filters.every((f) => f.op === 'eq' ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col] as never));
    const run = (): { data: unknown; error: unknown } => {
      if (op === 'insert') {
        if (failInserts) return { data: null, error: { message: 'insert failed' } };
        const inserted = { id: `gen${++gen}`, seq: ++seq, created_at: '2026-11-09T00:00:00Z', ...payload as Row };
        rows.push(inserted);
        return { data: [inserted], error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(matchesRow);
        for (const r of hit) Object.assign(r, payload as Row);
        return { data: hit, error: null };
      }
      let out = rows.filter(matchesRow);
      for (const o of orders) {
        out = [...out].sort((a, b) => {
          const av = a[o.col]; const bv = b[o.col];
          const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''));
          return o.ascending ? cmp : -cmp;
        });
      }
      return { data: out, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (col: string, val: unknown) => { filters.push({ col, op: 'eq', val }); return q; },
      in: (col: string, val: unknown) => { filters.push({ col, op: 'in', val }); return q; },
      order: (col: string, o: { ascending: boolean }) => { orders.push({ col, ascending: o.ascending }); return q; },
      insert: (r: Row) => { op = 'insert'; payload = r; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      maybeSingle: () => { const d = run().data; return Promise.resolve({ data: Array.isArray(d) ? (d[0] ?? null) : d, error: null }); },
      single: () => { const d = run().data; return Promise.resolve({ data: Array.isArray(d) ? d[0] : d, error: null }); },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from };
}

const asAdmin = (store: Store, failInserts = false) => fakeAdmin(store, failInserts) as never;

// ── Payload resolution ─────────────────────────────────────────────

describe('resolveUndoPayload', () => {
  it('takes the id the write result returned (design fixture 4)', () => {
    const out = resolveUndoPayload({
      declaration: createIssue.undo!, undoCommand: closeIssue,
      writeInput: { title: 'bug' }, resultState: { number: 42, html_url: 'https://x/42' },
    });
    expect(out).toEqual({ input: { issue_number: 42 }, unresolved: [] });
  });

  it('the write input wins over the result state on a shared field', () => {
    const out = resolveUndoPayload({
      declaration: { command: 'close_issue', input: { issue_number: 'number' } }, undoCommand: closeIssue,
      writeInput: { number: 7 }, resultState: { number: 42 },
    });
    expect(out.input).toEqual({ issue_number: 7 });
  });

  it('a mapping value naming no state field is a literal; non-strings are literals', () => {
    const undoCmd = cmd({ name: 'annotate', input: { note: { type: 'string' }, retries: { type: 'number' } }, required: ['note'] });
    const out = resolveUndoPayload({
      declaration: { command: 'annotate', input: { note: 'cleanup', retries: 3 } }, undoCommand: undoCmd,
      writeInput: {}, resultState: {},
    });
    expect(out).toEqual({ input: { note: 'cleanup', retries: 3 }, unresolved: [] });
  });

  it('narrows to the fields the undo command declares', () => {
    const out = resolveUndoPayload({
      declaration: { command: 'close_issue', input: { issue_number: 'number', debug: 'title' } }, undoCommand: closeIssue,
      writeInput: { title: 'bug' }, resultState: { number: 42 },
    });
    expect(out.input).toEqual({ issue_number: 42 });
  });

  it('names the required arguments the mapping left unfilled', () => {
    const out = resolveUndoPayload({
      declaration: { command: 'close_issue', input: {} }, undoCommand: closeIssue,
      writeInput: { title: 'bug' }, resultState: {},
    });
    expect(out).toEqual({ input: {}, unresolved: ['issue_number'] });
  });
});

describe('verifyStatusOf', () => {
  it('maps the verify outcomes onto the record vocabulary', () => {
    expect(verifyStatusOf(undefined)).toBeNull();
    expect(verifyStatusOf({ ok: true })).toBe('ok');
    expect(verifyStatusOf({ ok: false, diff: [] })).toBe('mismatch');
    expect(verifyStatusOf({ ok: false, unverified: '読めませんでした' })).toBe('unverified');
  });
});

// ── The record ─────────────────────────────────────────────────────

describe('recordWriteCompensation', () => {
  it('records an unasked write (no agent_actions row exists — fixture 5)', async () => {
    const store = emptyStore();
    const ok = await recordWriteCompensation(asAdmin(store), {
      runId: 'r1', spaceId: 's1', elementId: 'e1', integrationId: 'i1',
      command: createIssue, manifest: MANIFEST, toolUseId: 't1',
      writeInput: { title: 'bug' }, resultText: '{"number": 42}',
      verify: { ok: true },
    });
    expect(ok).toBe(true);
    expect(store.agent_actions).toHaveLength(0);
    expect(store.write_compensations).toHaveLength(1);
    expect(store.write_compensations[0]).toMatchObject({
      command_name: 'create_issue', undo_command_name: 'close_issue',
      undo_input: { issue_number: 42 }, unresolved: [], verify_status: 'ok',
      kind: 'write', status: 'pending',
    });
  });

  it('records nothing for a command with no declaration', async () => {
    const store = emptyStore();
    const ok = await recordWriteCompensation(asAdmin(store), {
      runId: 'r1', spaceId: 's1', elementId: 'e1', integrationId: 'i1',
      command: cmd({ name: 'send_mail' }), manifest: MANIFEST, toolUseId: 't1',
      writeInput: {}, resultText: 'ok',
    });
    expect(ok).toBe(false);
    expect(store.write_compensations).toHaveLength(0);
  });

  it('a verify-mismatched write still records (fixture 7), marked mismatch', async () => {
    const store = emptyStore();
    await recordWriteCompensation(asAdmin(store), {
      runId: 'r1', spaceId: 's1', elementId: 'e1', integrationId: 'i1',
      command: createIssue, manifest: MANIFEST, toolUseId: 't1',
      writeInput: { title: 'bug' }, resultText: '{"number": 42}',
      verify: { ok: false, diff: [{ field: 'title', expected: 'bug', actual: 'big' }] },
    });
    expect(store.write_compensations[0].verify_status).toBe('mismatch');
  });

  it('an unverifiable write records as unverified, and an incomplete payload names its gap', async () => {
    const store = emptyStore();
    // The declaration maps a field the undo command does not declare:
    // narrowing drops it, and the required argument stands unfilled.
    const badMap = cmd({
      name: 'create_issue', input: { title: { type: 'string' } }, required: ['title'],
      undo: { command: 'close_issue', input: { other: 'number' } },
    });
    await recordWriteCompensation(asAdmin(store), {
      runId: 'r1', spaceId: 's1', elementId: 'e1', integrationId: 'i1',
      command: badMap, manifest: MANIFEST, toolUseId: 't1',
      writeInput: { title: 'bug' }, resultText: '{"number": 42}',
      verify: { ok: false, unverified: '読み戻し先がありません' },
    });
    const r = store.write_compensations[0];
    expect(r.verify_status).toBe('unverified');
    expect(r.unresolved).toEqual(['issue_number']);
  });

  it('a failed record write reports false (the caller says so on the run)', async () => {
    const store = emptyStore();
    const ok = await recordWriteCompensation(asAdmin(store, true), {
      runId: 'r1', spaceId: 's1', elementId: 'e1', integrationId: 'i1',
      command: createIssue, manifest: MANIFEST, toolUseId: 't1',
      writeInput: { title: 'bug' }, resultText: '{"number": 42}',
    });
    expect(ok).toBe(false);
  });
});

describe('recordCompensationExecution', () => {
  it('leaves a born-settled compensation row pointing at its write', async () => {
    const store = emptyStore();
    await recordCompensationExecution(asAdmin(store), {
      runId: 'r1', spaceId: 's1', elementId: 'e1', integrationId: 'i1',
      commandName: 'close_issue', toolUseId: 'undo-w1', input: { issue_number: 42 },
      targetKey: null, compensatesId: 'w1', ok: true,
    });
    expect(store.write_compensations[0]).toMatchObject({
      kind: 'compensation', compensates_id: 'w1', status: 'compensated', command_name: 'close_issue',
    });
  });
});

// ── The set ────────────────────────────────────────────────────────

describe('compensationSetOf', () => {
  it('is reverse execution order, complete payloads only (fixture 1 order)', () => {
    const rows = [
      row({ id: 'w1', seq: 1 }), row({ id: 'w2', seq: 2 }), row({ id: 'w3', seq: 3 }),
    ] as never[];
    expect(compensationSetOf(rows).map((r: { id: string }) => r.id)).toEqual(['w3', 'w2', 'w1']);
  });

  it('never includes compensation rows, settled rows, or incomplete payloads (no recursion, fixture 6)', () => {
    const rows = [
      row({ id: 'w1', seq: 1 }),
      row({ id: 'c1', seq: 2, kind: 'compensation', compensates_id: 'w1' }),
      row({ id: 'w2', seq: 3, status: 'compensated' }),
      row({ id: 'w3', seq: 4, unresolved: ['issue_number'] }),
    ] as never[];
    expect(compensationSetOf(rows).map((r: { id: string }) => r.id)).toEqual(['w1']);
  });
});

// ── The report builder ─────────────────────────────────────────────

describe('buildCompensationReport', () => {
  const nameOf = (id: string) => (id === 'i1' ? 'GitHub' : id);
  const revOf = (_id: string, command: string) =>
    command === 'delete_repo' ? 'none' : command === 'create_issue' ? 'contained' : 'wide';

  it('names a no-undo write and a declared-irreversible write apart (fixture 3)', () => {
    const report = buildCompensationReport({
      rows: [] as never[],
      callLog: [
        { integration_id: 'i1', command_name: 'send_mail', is_write: true, ok: true, target_key: 'a@b.c' },
        { integration_id: 'i1', command_name: 'delete_repo', is_write: true, ok: true, target_key: 'repo=x' },
        { integration_id: 'i1', command_name: 'create_issue', is_write: true, ok: false, target_key: null },
      ],
      integrationNameOf: nameOf, reversibilityOfCommand: revOf as never,
    });
    const byCommand = new Map(report.uncompensated.map((u: { name: string; reason: string }) => [u.name, u.reason]));
    expect(byCommand.get('GitHub の send_mail')).toContain('宣言されていません');
    expect(byCommand.get('GitHub の send_mail')).not.toContain('不可逆');
    expect(byCommand.get('GitHub の delete_repo')).toContain('不可逆');
    // The write that never landed is reference only.
    expect(report.failedWrites.map((f: { name: string }) => f.name)).toEqual(['GitHub の create_issue']);
  });

  it('accounts compensation executions out of the landed writes', () => {
    const report = buildCompensationReport({
      rows: [
        row({ id: 'w1', seq: 1, status: 'compensated' }),
        row({ id: 'c1', seq: 2, kind: 'compensation', command_name: 'close_issue', compensates_id: 'w1', status: 'compensated' }),
      ] as never[],
      callLog: [
        { integration_id: 'i1', command_name: 'create_issue', is_write: true, ok: true, target_key: null },
        { integration_id: 'i1', command_name: 'close_issue', is_write: true, ok: true, target_key: null },
      ],
      integrationNameOf: nameOf, reversibilityOfCommand: revOf as never,
    });
    expect(report.compensated).toHaveLength(1);
    expect(report.uncompensated).toHaveLength(0);
  });

  it('an interrupted (still compensating) row reads as state-unknown', () => {
    const report = buildCompensationReport({
      rows: [row({ id: 'w1', status: 'compensating' })] as never[],
      callLog: [{ integration_id: 'i1', command_name: 'create_issue', is_write: true, ok: true, target_key: null }],
      integrationNameOf: nameOf, reversibilityOfCommand: revOf as never,
    });
    expect(report.uncompensated[0].reason).toContain('状態不明');
  });

  it('loads end to end over the fake admin', async () => {
    const store = emptyStore();
    store.write_compensations.push(row({ id: 'w1', status: 'compensated' }));
    store.integration_call_log.push({ run_id: 'r1', integration_id: 'i1', command_name: 'create_issue', is_write: true, ok: true, target_key: null });
    const report = await loadCompensationReport(asAdmin(store), 'r1');
    expect(report.compensated.map((c: { name: string }) => c.name)).toEqual(['GitHub の create_issue']);
  });
});

// ── The policy seam default ────────────────────────────────────────

describe('the engine policy source', () => {
  it('defaults to ask', () => {
    expect(COMPENSATION_DEFAULT).toBe('ask');
    expect(engineCompensationPolicy.policyFor({ runId: 'r1', definitionId: null, failureClass: 'run_failure' })).toBe('ask');
  });
});

// ── finish_detail: the compensation summary round-trip ─────────────

describe('finish detail compensation summary', () => {
  const summary = { compensated: 2, compensationFailed: 1, declined: 0, uncompensated: ['GitHub の send_mail'] };

  it('seals and parses back identically on server and web', () => {
    const sealed = finishClaims.finishDetailOf({ claims: [], unconfirmed: [], compensation: summary });
    expect(sealed.compensation).toEqual(summary);
    expect(finishClaims.parseFinishDetail(sealed)).toEqual(sealed);
    expect(parseFinishDetailWeb(sealed)).toEqual(sealed);
  });

  it('a finish without a pass seals no compensation field (the B1 expectation stands)', () => {
    const sealed = finishClaims.finishDetailOf({});
    expect(sealed).toEqual({ claims: [], unconfirmed: [] });
    expect(finishClaims.parseFinishDetail(sealed)).toEqual(sealed);
    expect(parseFinishDetailWeb(sealed)).toEqual(sealed);
  });

  it('a malformed compensation summary is not a finish detail, on either side', () => {
    const bad = { claims: [], unconfirmed: [], compensation: { compensated: -1, compensationFailed: 0, declined: 0, uncompensated: [] } };
    expect(finishClaims.parseFinishDetail(bad)).toBeNull();
    expect(parseFinishDetailWeb(bad)).toBeNull();
  });
});

// ── The pass ───────────────────────────────────────────────────────

const {
  runCompensationPass, mergeCompensationBatchOutcome, compensationReportText,
} = comp;

type ToolCallT = { id: string; name: string; input: Record<string, unknown> };

/** A store where a run landed two undo-declaring writes and failed a
 *  third: rows for the two, call-log rows for all three. w2's payload
 *  carries 999 — a value no re-derivation from today's manifest
 *  would produce — so a pass that re-derives instead of reading the
 *  record fails these tests. */
function landedStore(): Store {
  const store = emptyStore();
  store.write_compensations.push(
    row({ id: 'w1', seq: 1, tool_use_id: 't1', undo_input: { issue_number: 41 } }),
    row({ id: 'w2', seq: 2, tool_use_id: 't2', undo_input: { issue_number: 999 } }),
  );
  store.integration_call_log.push(
    { seq: 1, run_id: 'r1', integration_id: 'i1', command_name: 'create_issue', is_write: true, ok: true, target_key: null },
    { seq: 2, run_id: 'r1', integration_id: 'i1', command_name: 'create_issue', is_write: true, ok: true, target_key: null },
    { seq: 3, run_id: 'r1', integration_id: 'i1', command_name: 'send_mail', is_write: true, ok: false, target_key: 'a@b.c' },
  );
  return store;
}

function passDeps(store: Store, opts: {
  failFor?: (call: ToolCallT) => boolean;
  verdictFor?: (call: ToolCallT) => { base: string; final: string; lift: null };
  gone?: boolean;
} = {}) {
  const executed: ToolCallT[] = [];
  const deps = {
    resolveUndoTool: (_iid: string, commandName: string) =>
      opts.gone || commandName !== 'close_issue' ? null : { toolName: 'github__close_issue' },
    verdictOf: (call: ToolCallT) => opts.verdictFor?.(call) ?? { base: 'allow', final: 'allow', lift: null },
    executeUndo: async (call: ToolCallT) => {
      executed.push(call);
      const ok = !opts.failFor?.(call);
      // The seam's own records, as callIntegration leaves them.
      store.integration_call_log.push({
        seq: 90 + executed.length, run_id: 'r1', integration_id: 'i1', command_name: 'close_issue',
        is_write: true, ok, target_key: null,
      });
      await recordCompensationExecution(asAdmin(store), {
        runId: 'r1', spaceId: 's1', elementId: 'e1', integrationId: 'i1', commandName: 'close_issue',
        toolUseId: call.id, input: call.input, targetKey: null,
        compensatesId: call.id.slice('undo-'.length), ok,
        reason: ok ? null : '実行エラー: boom',
      });
      return ok ? { ok: true } : { ok: false, errorText: 'boom' };
    },
    displayFor: (call: ToolCallT) => ({
      id: call.id, integration: 'GitHub', operation: 'close_issue', destination: 'https://api.github.com',
      detail: null, effect: 'write', critical: null, rememberable: false, title: 'Close issue',
      fields: [], preview: null, askReason: null,
    }),
  };
  return { deps: deps as never, executed };
}

const autoSource = { policyFor: () => 'auto' as const };
const rowStatus = (store: Store, id: string) => store.write_compensations.find((r) => r.id === id)?.status;

describe('runCompensationPass — auto', () => {
  it('executes the set in reverse order with the recorded payloads (fixture 1)', async () => {
    const store = landedStore();
    const { deps, executed } = passDeps(store);
    const outcome = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: null, policySource: autoSource, deps,
    });
    expect(outcome.kind).toBe('settled');
    expect(executed.map((c) => c.input)).toEqual([{ issue_number: 999 }, { issue_number: 41 }]);
    expect(rowStatus(store, 'w1')).toBe('compensated');
    expect(rowStatus(store, 'w2')).toBe('compensated');
    // Each unasked undo ran under its own born-approved action row.
    expect(store.agent_actions).toHaveLength(2);
    expect(store.agent_actions.every((a) => a.decision_source === 'compensation' && a.status === 'executed')).toBe(true);
    if (outcome.kind === 'settled') {
      expect(outcome.report.compensated).toHaveLength(2);
      expect(outcome.report.failedWrites.map((f: { name: string }) => f.name)).toEqual(['GitHub の send_mail']);
      expect(compensationReportText(outcome.report)).not.toContain('補償は不完全です');
    }
  });

  it('one undo failing stops nothing else, and the report says incomplete (fixture 6)', async () => {
    const store = landedStore();
    const { deps, executed } = passDeps(store, { failFor: (c) => c.input.issue_number === 999 });
    const outcome = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: null, policySource: autoSource, deps,
    });
    expect(executed).toHaveLength(2); // the failure did not stop the rest
    expect(rowStatus(store, 'w2')).toBe('compensation_failed');
    expect(store.write_compensations.find((r) => r.id === 'w2')?.status_reason).toContain('実行エラー');
    expect(rowStatus(store, 'w1')).toBe('compensated');
    if (outcome.kind === 'settled') {
      expect(outcome.report.failed).toHaveLength(1);
      expect(compensationReportText(outcome.report)).toContain('補償は不完全です');
    }
    // No recursion, and a second pass is a no-op (fixture 10): the
    // compensation rows never enter a set, and settled rows are done.
    const again = passDeps(store);
    const second = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: null, policySource: autoSource, deps: again.deps,
    });
    expect(again.executed).toHaveLength(0);
    expect(second.kind).toBe('settled');
  });

  it('an ask verdict holds its undo into the batch; a deny never executes (fixture 8)', async () => {
    const store = landedStore();
    const { deps, executed } = passDeps(store, {
      verdictFor: (c) => c.input.issue_number === 999
        ? { base: 'ask', final: 'ask', lift: null }
        : { base: 'deny', final: 'deny', lift: null },
    });
    const outcome = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: null, policySource: autoSource, deps,
    });
    expect(executed).toHaveLength(0);
    expect(rowStatus(store, 'w1')).toBe('compensation_failed');
    expect(store.write_compensations.find((r) => r.id === 'w1')?.status_reason).toContain('ポリシーで拒否');
    expect(rowStatus(store, 'w2')).toBe('pending'); // released back, offered
    expect(outcome.kind).toBe('rest');
    if (outcome.kind === 'rest') {
      expect(outcome.entries).toEqual([{ callId: 'undo-w2', rowId: 'w2' }]);
      expect(outcome.report.offered).toHaveLength(1);
      expect(outcome.report.failed).toHaveLength(1);
    }
  });
});

describe('runCompensationPass — ask (the engine default) and the policy seam', () => {
  it('holds the whole set as one batch, executing nothing (fixture 2)', async () => {
    const store = landedStore();
    const { deps, executed } = passDeps(store);
    const outcome = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: null, deps, // no source: the engine default
    });
    expect(executed).toHaveLength(0);
    expect(outcome.kind).toBe('rest');
    if (outcome.kind === 'rest') {
      expect(outcome.calls.map((c: ToolCallT) => c.input)).toEqual([{ issue_number: 999 }, { issue_number: 41 }]);
      expect(outcome.entries).toEqual([
        { callId: 'undo-w2', rowId: 'w2' }, { callId: 'undo-w1', rowId: 'w1' },
      ]);
      expect(outcome.report.offered).toHaveLength(2);
    }
    expect(rowStatus(store, 'w1')).toBe('pending');
    expect(rowStatus(store, 'w2')).toBe('pending');
  });

  it('an undo whose command is gone settles failed, named — never offered (fixture 15)', async () => {
    const store = landedStore();
    const { deps, executed } = passDeps(store, { gone: true });
    const outcome = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: null, deps,
    });
    expect(executed).toHaveLength(0);
    expect(outcome.kind).toBe('settled');
    expect(rowStatus(store, 'w1')).toBe('compensation_failed');
    expect(store.write_compensations.find((r) => r.id === 'w1')?.status_reason).toContain('manifest にありません');
  });

  it('a policy source returning never only reports (fixture 16: the B13 seam)', async () => {
    const store = landedStore();
    const { deps, executed } = passDeps(store);
    const seen: unknown[] = [];
    const outcome = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: 'def-1',
      policySource: { policyFor: (args: unknown) => { seen.push(args); return 'never' as const; } },
      deps,
    });
    expect(seen).toEqual([{ runId: 'r1', definitionId: 'def-1', failureClass: 'run_failure' }]);
    expect(executed).toHaveLength(0);
    expect(rowStatus(store, 'w1')).toBe('reported');
    if (outcome.kind === 'settled') {
      expect(outcome.report.uncompensated.map((u: { reason: string }) => u.reason))
        .toContain('ポリシーにより補償は実行されませんでした');
    }
  });
});

describe('the batch decision merge and the not-executed report', () => {
  it('approval seals by outcome; rejection declines all (fixture 9)', async () => {
    const store = landedStore();
    const { deps } = passDeps(store);
    const outcome = await runCompensationPass(asAdmin(store), {
      runId: 'r1', elementId: 'e1', definitionId: null, deps,
    });
    if (outcome.kind !== 'rest') throw new Error('expected a rest');
    const approved = mergeCompensationBatchOutcome(outcome.report, {
      approved: true,
      outcomes: new Map([['w2', { ok: true }], ['w1', { ok: false, reason: '実行エラー: boom' }]]),
    });
    expect(approved.compensated.map((c: { name: string }) => c.name)).toEqual(['GitHub の create_issue']);
    expect(approved.failed).toHaveLength(1);
    expect(approved.offered).toHaveLength(0);
    const rejected = mergeCompensationBatchOutcome(outcome.report, { approved: false, outcomes: new Map() });
    expect(rejected.declined).toHaveLength(2);
    expect(rejected.compensated).toHaveLength(0);
  });

  it('a cancelled run’s pending payloads report as not executed, rows untouched (fixture 13)', () => {
    const rows = [row({ id: 'w1', status: 'pending' })];
    const report = buildCompensationReport({
      rows: rows as never[],
      callLog: [{ integration_id: 'i1', command_name: 'create_issue', is_write: true, ok: true, target_key: null }],
      integrationNameOf: (id: string) => (id === 'i1' ? 'GitHub' : id),
      reversibilityOfCommand: () => 'contained',
    });
    expect(report.uncompensated).toHaveLength(1);
    expect(report.uncompensated[0].reason).toBe('補償は実行されませんでした');
    expect(rows[0].status).toBe('pending');
  });
});

// ── The card marker (PR4) ──────────────────────────────────────────

describe('compensationMarkerOf', () => {
  it('reads the engine’s marker off the action input', () => {
    expect(compensationMarkerOf({ input: { compensation: { setSize: 2, failureSummary: '失敗しました' } } } as never))
      .toEqual({ setSize: 2, failureSummary: '失敗しました' });
  });

  it('an ordinary ask, or a malformed marker, reads as no marker', () => {
    expect(compensationMarkerOf({ input: { calls: [] } } as never)).toBeNull();
    expect(compensationMarkerOf({ input: { compensation: { setSize: '2', failureSummary: 'x' } } } as never)).toBeNull();
    expect(compensationMarkerOf({ input: null } as never)).toBeNull();
  });
});

// ── The B13 seam supply (§11): the pass asks failurePolicySource ────
// The B9 tests above pin the pass against its own sources; these pin
// the adapter B13 hands it: a definition row's compensate word comes
// back per class, an installed entry speaks under the row, and with
// neither, the answer is COMPENSATION_DEFAULT — B9's behaviour whole.
describe('the failure-policy seam supply (B13)', () => {
  it('a definition row’s compensate returns per class; silence is the default', async () => {
    const fp = await import(new URL('../../supabase/functions/_shared/failurePolicy.ts', import.meta.url).pathname);
    const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);
    const definition = def.parseDefinition([
      '# 失敗時の扱い',
      '- read_failed: compensate auto, escalate inbox',
      '- write_failed: compensate never, escalate owner',
    ].join('\n'));
    const source = fp.failurePolicySource({ definition, entries: [] });
    expect(source.policyFor({ runId: 'r', definitionId: 'd', failureClass: 'read_failed' })).toBe('auto');
    expect(source.policyFor({ runId: 'r', definitionId: 'd', failureClass: 'write_failed' })).toBe('never');
    expect(source.policyFor({ runId: 'r', definitionId: 'd', failureClass: 'auth_failed' })).toBe(COMPENSATION_DEFAULT);
    expect(engineCompensationPolicy.policyFor({ runId: 'r', definitionId: null, failureClass: 'run_failure' })).toBe(COMPENSATION_DEFAULT);
  });

  it('an installed entry speaks under the definition row, per field', async () => {
    const fp = await import(new URL('../../supabase/functions/_shared/failurePolicy.ts', import.meta.url).pathname);
    const def = await import(new URL('../../supabase/functions/_shared/definition.ts', import.meta.url).pathname);
    const definition = def.parseDefinition('# 失敗時の扱い\n- read_failed: compensate auto, escalate inbox');
    const entries = [{
      id: 'exc.test', name: 'test', version: 1,
      match: { errorClass: null, destinationPattern: null, tool: null },
      rows: [
        { class: 'read_failed', retry: null, compensate: 'never', escalate: 'inbox', giveUpAfter: null },
        { class: 'unavailable', retry: null, compensate: 'never', escalate: 'inbox', giveUpAfter: null },
      ],
    }];
    const source = fp.failurePolicySource({ definition, entries });
    // the row wins for its class; the entry governs the class the row
    // never named
    expect(source.policyFor({ runId: 'r', definitionId: 'd', failureClass: 'read_failed' })).toBe('auto');
    expect(source.policyFor({ runId: 'r', definitionId: 'd', failureClass: 'unavailable' })).toBe('never');
  });
});
