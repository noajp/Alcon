import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  agentRunEvents, agentRunNeedsPerson, agentRunOutcome, auditShowsSample, exceptionReason, flowObservation, grantChanges, grantConnectors,
  mergeAuditTimeline, parseChainScope, parseFailureDetail, runOutcome, sealChain, summarizeDeployment, templateSteps, verifyChain,
  type AgentRunRecord, type ChainStep, type LedgerRun, type RunVerdict, type WorkflowRunRecord, type WorkflowStepRecord,
} from '@/Function/audit/auditModel';

const sha = async (text: string) => createHash('sha256').update(text).digest('hex');

let seq = 0;
function step(patch: Partial<WorkflowStepRecord>): WorkflowStepRecord {
  seq += 1;
  return {
    id: `s${seq}`, run_id: 'r1', deployment_id: 'd1', step_key: `k${seq}`, kind: 'step', connector: null,
    operation: 'none', result: 'ok', actor_kind: 'ai_agent', actor_name: null, reason: null,
    occurred_at: '2026-10-26T01:00:00Z', duration_ms: null, seq, prev_hash: '', hash: '', grants_version: null, outside_grant: false, ...patch,
  };
}

describe('runOutcome', () => {
  it('reads a finished run by who finished it', () => {
    expect(runOutcome([step({ kind: 'start' }), step({}), step({ kind: 'end' })])).toBe('auto');
    expect(runOutcome([step({}), step({ kind: 'approval', result: 'approved', actor_kind: 'human' }), step({ kind: 'end' })])).toBe('approved');
    expect(runOutcome([step({}), step({ kind: 'approval', result: 'returned', actor_kind: 'human' }), step({ kind: 'end' })])).toBe('returned');
    expect(runOutcome([step({}), step({ kind: 'end', result: 'failed' })])).toBe('stopped');
  });

  it('lets a blocked operation outweigh a clean finish', () => {
    expect(runOutcome([step({ result: 'blocked', operation: 'send' }), step({ kind: 'end' })])).toBe('deviation');
  });

  it('reads an operation carried out outside the grants as a deviation too', () => {
    expect(runOutcome([step({ operation: 'send', connector: 'gmail', outside_grant: true }), step({ kind: 'end' })])).toBe('deviation');
  });

  it('says what an unfinished run is waiting on', () => {
    expect(runOutcome([step({}), step({ kind: 'exception', reason: 'unknown_item' })])).toBe('exception');
    expect(runOutcome([step({}), step({ kind: 'approval', result: 'waiting' })])).toBe('waiting');
    expect(runOutcome([step({}), step({ result: 'failed', connector: 'sales' })])).toBe('stopped');
    expect(runOutcome([step({ kind: 'start' }), step({})])).toBe('running');
    expect(runOutcome([])).toBe('running');
  });

  it('reads steps in chain order, not the order they were fetched', () => {
    const a = step({ kind: 'approval', result: 'waiting' });
    const b = step({ kind: 'approval', result: 'approved' });
    expect(runOutcome([b, a])).toBe('running');
    expect(exceptionReason([step({ kind: 'exception', reason: 'low_confidence' }), step({})])).toBe('low_confidence');
  });
});

describe('summarizeDeployment', () => {
  it('counts outcomes, rates and the connectors actually called', () => {
    const runs: WorkflowRunRecord[] = ['a', 'b', 'c', 'd'].map((id, i) => ({
      id, deployment_id: 'd1', external_id: id, template_version: 1, subject_ref: null, subject_digest: null, started_at: `2026-10-2${i}T00:00:00Z`,
    }));
    const steps = new Map<string, WorkflowStepRecord[]>([
      ['a', [step({ run_id: 'a', connector: 'gmail', operation: 'read' }), step({ run_id: 'a', kind: 'end' })]],
      ['b', [step({ run_id: 'b', connector: 'gmail' }), step({ run_id: 'b', kind: 'approval', result: 'approved' }), step({ run_id: 'b', kind: 'end' })]],
      ['c', [step({ run_id: 'c', kind: 'approval', result: 'returned' }), step({ run_id: 'c', kind: 'end' })]],
      ['d', [step({ run_id: 'd', connector: 'sales', result: 'blocked', operation: 'money' })]],
    ]);
    const summary = summarizeDeployment(runs, steps);
    expect(summary.runs).toBe(4);
    expect(summary.outcomes).toMatchObject({ auto: 1, approved: 1, returned: 1, deviation: 1 });
    expect(summary.autoRate).toBeCloseTo(1 / 3);
    expect(summary.returnRate).toBe(0.5);
    expect(summary.needsPerson).toBe(1);
    expect(summary.connectors).toEqual([
      { connector: 'gmail', calls: 2, failed: 0, blocked: 0 },
      { connector: 'sales', calls: 1, failed: 0, blocked: 1 },
    ]);
    expect(summary.lastRunAt).toBe('2026-10-23T00:00:00Z');
  });

  it('leaves a rate empty rather than calling it zero', () => {
    const summary = summarizeDeployment([], new Map());
    expect(summary.autoRate).toBeNull();
    expect(summary.returnRate).toBeNull();
  });
});

describe('flowObservation', () => {
  it('lays what happened over the declared steps and keeps routes outside the design', () => {
    const flow = flowObservation([{ key: 'receive', label: '受信' }, { key: 'read', label: '読み取り' }, { key: 'enter', label: '入力' }, { key: 'send', label: '送信' }], [
      step({ kind: 'start', step_key: 'receive', connector: 'fax' }),
      step({ step_key: 'read', connector: 'gmail' }),
      step({ step_key: 'read', connector: 'fax' }),
      step({ step_key: 'enter', connector: 'sales', result: 'failed' }),
      step({ step_key: 'bulk-send', connector: 'gmail', result: 'blocked', operation: 'send' }),
      step({ kind: 'end', step_key: 'end' }),
    ]);
    expect(flow.map(s => [s.key, s.declared, s.events, s.failed, s.blocked])).toEqual([
      ['receive', true, 1, 0, 0], ['read', true, 2, 0, 0], ['enter', true, 1, 1, 0], ['send', true, 0, 0, 0], ['bulk-send', false, 1, 0, 1],
    ]);
    expect(flow[1].connectors).toEqual(['fax', 'gmail']);
  });
});

describe('templateSteps', () => {
  it('keeps well-formed steps and falls back to the key for a label', () => {
    expect(templateSteps([{ key: 'read', label: '読み取り' }, { key: 'send' }, { label: 'x' }, null, 'y'])).toEqual([
      { key: 'read', label: '読み取り' }, { key: 'send', label: 'send' },
    ]);
    expect(templateSteps({})).toEqual([]);
  });
});

const GENESIS_HASH = '0'.repeat(64);

describe('the hash chain', () => {
  // Produced by the migration's workflow_step_chain trigger on Postgres 16.
  // Multi-byte text (the document number, the agent's name) checks that a
  // field's length is counted in bytes on both sides.
  const run = { external_id: 'r1', subject_ref: '注文書 No.1', subject_digest: 'ab12', started_at: '2026-10-26T01:00:00.25+00:00' };
  const first: ChainStep = {
    id: 'x', run_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', deployment_id: 'd', step_key: 'read', kind: 'step', connector: null,
    operation: 'none', result: 'ok', actor_kind: 'ai_agent', actor_name: '受注エージェント', reason: null,
    occurred_at: '2026-10-26T01:02:03.5+00:00', duration_ms: 120, seq: 1, prev_hash: GENESIS_HASH,
    hash: '7225e56d3ef43c5afda3a837bf468548d41b9d9a2927ed3f829c6cd2450f1efe', grants_version: null, outside_grant: false, run,
  };
  const second: ChainStep = {
    ...first, id: 'y', step_key: 'enter', connector: '販売管理', operation: 'draft', actor_name: null,
    occurred_at: '2026-10-26T01:02:04+00:00', duration_ms: null, seq: 2, prev_hash: first.hash,
    hash: '21b94d34748d41b7154025aa9b58be36a8457386f6ef7ea53bd6bf7c3ee83e32',
  };

  it('hashes the same text the database hashed', async () => {
    expect(await verifyChain([second, first], sha)).toEqual([]);
  });

  it('reads the time the way Postgres prints it, whatever the zone or precision', async () => {
    // The same instant, as Supabase, another zone, or a bare Z would give it.
    for (const occurred_at of ['2026-10-26T01:02:03.500000+00:00', '2026-10-26 10:02:03.5+09', '2026-10-26T01:02:03.5Z']) {
      expect(await verifyChain([{ ...first, occurred_at }], sha)).toEqual([]);
    }
    expect(await verifyChain([{ ...first, occurred_at: '2026-10-26T01:02:03Z' }], sha)).toEqual([{ seq: 1, kind: 'hash' }]);
  });

  it('finds an altered step, an altered run, a broken link and a missing one', async () => {
    expect(await verifyChain([first, { ...second, result: 'failed' }], sha)).toEqual([{ seq: 2, kind: 'hash' }]);
    expect(await verifyChain([first, { ...second, run: { ...run, subject_ref: '注文書 No.2' } }], sha)).toEqual([{ seq: 2, kind: 'hash' }]);
    expect(await verifyChain([first, { ...second, prev_hash: GENESIS_HASH }], sha)).toEqual([{ seq: 2, kind: 'link' }, { seq: 2, kind: 'hash' }]);
    expect(await verifyChain([first, { ...second, seq: 3 }], sha)).toEqual([{ seq: 3, kind: 'gap' }, { seq: 3, kind: 'hash' }]);
  });

  it('seals steps into the same chain the database builds', async () => {
    const sealed = await sealChain([{ ...first, seq: 0, prev_hash: '', hash: '' }, { ...second, seq: 0, prev_hash: '', hash: '' }], sha);
    expect(sealed.map(s => [s.seq, s.hash])).toEqual([[1, first.hash], [2, second.hash]]);
    expect(await verifyChain(sealed, sha)).toEqual([]);
  });

  it('keeps field boundaries: moving text between neighbours changes the hash', async () => {
    expect(await verifyChain([{ ...first, actor_name: '受注エージェント|', reason: null }], sha)).toEqual([{ seq: 1, kind: 'hash' }]);
    expect(await verifyChain([{ ...first, actor_name: '受注', reason: 'エージェント' }], sha)).toEqual([{ seq: 1, kind: 'hash' }]);
  });
});

describe('grants', () => {
  it('lists granted connections first, then those runs called without a grant', () => {
    const grants = [{ connector: 'gmail', operation: 'send' as const }, { connector: 'erp', operation: 'draft' as const }, { connector: 'gmail', operation: 'read' as const }];
    expect(grantConnectors(grants, ['slack', 'gmail', 'bank', 'slack'])).toEqual(['erp', 'gmail', 'bank', 'slack']);
  });

  it('says what a version added and removed', () => {
    const before = [{ connector: 'gmail', operation: 'read' as const }, { connector: 'erp', operation: 'draft' as const }];
    const after = [{ connector: 'gmail', operation: 'read' as const }, { connector: 'gmail', operation: 'send' as const }];
    expect(grantChanges(before, after)).toEqual({ added: [{ connector: 'gmail', operation: 'send' }], removed: [{ connector: 'erp', operation: 'draft' }] });
  });
});

const verdictFixture = (result: 'pass' | 'fail' | 'unchecked'): RunVerdict => ({
  v: 1, result, source: result === 'unchecked' ? 'none' : 'verifier', model: 'claude-test', gaps: [], revisions: 0,
  checkedAt: '2026-11-07T01:00:00Z', outcome: 'completed', reason: null, evidence: { verifyStepIdx: 3, artifactIds: [] },
});

function agentRun(patch: Partial<AgentRunRecord>): AgentRunRecord {
  return {
    id: 'ar1', element_id: 'e1', domain_id: null, worker_id: null, status: 'running', mode: 'execute',
    summary: null, error: null, started_at: '2026-11-06T01:00:00Z', finished_at: null, created_at: '2026-11-06T01:00:00Z',
    cost_usd: 0, verdict: null, finishDetail: null, failureDetail: null, proposed_readings: null, elementTitle: '経費処理', elementStatus: 'todo', objectName: null,
    chainScope: null, chainIntegrationNames: [],
    pendingActions: 0, ...patch,
  };
}

describe('agentRunOutcome', () => {
  it('reads standing states in their own vocabulary', () => {
    expect(agentRunOutcome(agentRun({ status: 'queued' }))).toBe('running');
    expect(agentRunOutcome(agentRun({ status: 'running' }))).toBe('running');
    expect(agentRunOutcome(agentRun({ status: 'awaiting_input' }))).toBe('waiting');
    expect(agentRunOutcome(agentRun({ status: 'awaiting_approval', pendingActions: 2 }))).toBe('waiting');
    expect(agentRunOutcome(agentRun({ status: 'paused' }))).toBe('waiting');
    expect(agentRunOutcome(agentRun({ status: 'awaiting_review' }))).toBe('review');
    expect(agentRunOutcome(agentRun({ status: 'failed' }))).toBe('failed');
    expect(agentRunOutcome(agentRun({ status: 'cancelled' }))).toBe('cancelled');
  });

  it('reads a completed run by its verdict: pass, fail, or honestly unchecked', () => {
    expect(agentRunOutcome(agentRun({ status: 'completed', verdict: verdictFixture('pass') }))).toBe('passed');
    expect(agentRunOutcome(agentRun({ status: 'completed', verdict: verdictFixture('fail') }))).toBe('unpassed');
    expect(agentRunOutcome(agentRun({ status: 'completed', verdict: verdictFixture('unchecked') }))).toBe('completed');
    expect(agentRunOutcome(agentRun({ status: 'completed', verdict: null }))).toBe('completed');
  });
});

describe('agentRunNeedsPerson', () => {
  it('asks a person only for approval, review and failure — paused is not attention', () => {
    expect(agentRunNeedsPerson(agentRun({ status: 'awaiting_approval', pendingActions: 1 }))).toBe(true);
    expect(agentRunNeedsPerson(agentRun({ status: 'awaiting_review' }))).toBe(true);
    expect(agentRunNeedsPerson(agentRun({ status: 'failed' }))).toBe(true);
    for (const status of ['queued', 'running', 'awaiting_input', 'paused', 'completed', 'cancelled'] as const) {
      expect(agentRunNeedsPerson(agentRun({ status }))).toBe(false);
    }
  });
});

describe('mergeAuditTimeline', () => {
  const ledgerRun = (id: string, started_at: string, steps: WorkflowStepRecord[] = []): LedgerRun => ({
    id, deployment_id: 'd1', external_id: id, template_version: 1, subject_ref: null, subject_digest: null, started_at,
    steps: steps.map(s => ({ seq: s.seq, step_key: s.step_key, kind: s.kind, connector: s.connector, operation: s.operation, result: s.result, reason: s.reason, outside_grant: s.outside_grant })),
  });

  it('interleaves both sources newest-first, keys them apart, and flags who needs a person', () => {
    const merged = mergeAuditTimeline(
      [ledgerRun('l1', '2026-11-06T02:00:00Z'), ledgerRun('l2', '2026-11-06T00:00:00Z', [step({ kind: 'exception' })])],
      [agentRun({ id: 'a1', started_at: '2026-11-06T03:00:00Z' }), agentRun({ id: 'a2', started_at: null, created_at: '2026-11-06T01:00:00Z', status: 'awaiting_review' })],
    );
    expect(merged.map(e => e.key)).toEqual(['agent:a1', 'ledger:l1', 'agent:a2', 'ledger:l2']);
    expect(merged.map(e => e.needsPerson)).toEqual([false, false, true, true]);
  });

  it('lets the ledger win a tie — it carries the stronger record', () => {
    const merged = mergeAuditTimeline(
      [ledgerRun('l1', '2026-11-06T01:00:00Z')],
      [agentRun({ id: 'a1', started_at: '2026-11-06T01:00:00Z' })],
    );
    expect(merged.map(e => e.key)).toEqual(['ledger:l1', 'agent:a1']);
  });
});

describe('agentRunEvents', () => {
  const steps = [
    { idx: 2, type: 'result', title: '完了', detail: '3 件処理', created_at: '2026-11-06T01:02:00Z' },
    { idx: 0, type: 'plan', title: '計画', detail: null, created_at: '2026-11-06T01:00:00Z' },
    { idx: 1, type: 'error', title: '失敗', detail: '接続できませんでした', created_at: '2026-11-06T01:01:00Z' },
  ];
  it('maps steps in idx order, errors as exceptions, and never invents chain fields', () => {
    const events = agentRunEvents(steps, []);
    expect(events.map(e => [e.seq, e.step_key, e.kind, e.result])).toEqual([
      [0, 'plan', 'step', 'ok'],
      [1, 'error', 'exception', 'failed'],
      [2, 'result', 'step', 'ok'],
    ]);
    expect(events[1].reason).toBe('接続できませんでした');
    expect(events.every(e => e.connector === null && e.operation === 'none' && e.outside_grant === false)).toBe(true);
  });

  it('interleaves approvals by time, steps first on a tie, with each status read as its result', () => {
    const events = agentRunEvents(steps, [
      { status: 'approved', summary: '送信を承認', created_at: '2026-11-06T01:01:00Z' },
      { status: 'pending', summary: '削除の承認待ち', created_at: '2026-11-06T01:03:00Z' },
      { status: 'rejected', summary: '却下された送信', created_at: '2026-11-06T00:59:00Z' },
    ]);
    expect(events.map(e => [e.kind, e.result, e.reason])).toEqual([
      ['approval', 'returned', '却下された送信'],
      ['step', 'ok', null],
      ['exception', 'failed', '接続できませんでした'],
      ['approval', 'approved', '送信を承認'],
      ['step', 'ok', '3 件処理'],
      ['approval', 'waiting', '削除の承認待ち'],
    ]);
  });

  it("marks a policy approval as the policy's, never as a person's decision", () => {
    const events = agentRunEvents(steps, [
      { status: 'executed', summary: 'Mail: send', created_at: '2026-11-06T01:01:00Z', decision_source: 'policy', policy_mode: 'free' },
      { status: 'executed', summary: '人が承認した送信', created_at: '2026-11-06T01:01:30Z', decision_source: null, policy_mode: null },
    ]);
    const approvals = events.filter(e => e.kind === 'approval');
    expect(approvals.map(e => e.reason)).toEqual(['ポリシー承認: Mail: send', '人が承認した送信']);
  });
});

describe('auditShowsSample', () => {
  it('shows the sample only while the Space has no AI work at all', () => {
    expect(auditShowsSample(0, 0)).toBe(true);
    expect(auditShowsSample(1, 0)).toBe(false);
    expect(auditShowsSample(0, 3)).toBe(false);
  });
});

describe('chain scopes in the audit (B10)', () => {
  const scopeOf = (patch: Record<string, unknown> = {}) => parseChainScope({
    v: 1, rootRunId: 'root1', parentRunId: 'ar1', strategyId: null, depth: 1, maxDepth: 8,
    actions: ['gh:issues.create'], integrations: ['gh'], ...patch,
  });

  it('parseChainScope mirrors the server: absent is null, valid is canonical', () => {
    expect(parseChainScope(null)).toBeNull();
    expect(parseChainScope(undefined)).toBeNull();
    const scope = parseChainScope({
      v: 1, rootRunId: 'root1', parentRunId: 'p1', strategyId: null, depth: 2, maxDepth: 8,
      actions: ['b:x', 'a:y', 'a:y'], integrations: ['gh', 'gh'],
    });
    expect(scope?.actions).toEqual(['a:y', 'b:x']);
    expect(scope?.integrations).toEqual(['gh']);
  });

  it('a malformed scope reads as the empty scope — never as unscoped', () => {
    for (const bad of ['scoped', [], { v: 2 }, { v: 1, rootRunId: 'r', parentRunId: 'p', strategyId: null, depth: -1, maxDepth: 8, actions: [], integrations: [] }]) {
      const scope = parseChainScope(bad);
      expect(scope).not.toBeNull();
      expect(scope?.actions).toEqual([]);
      expect(scope?.integrations).toEqual([]);
    }
  });
});

describe('parseFailureDetail (B13)', () => {
  const good = {
    class: 'auth_failed',
    compensate: { policy: 'ask', source: 'catalog' },
    escalate: { target: 'owner', source: 'catalog' },
    retries: 2,
    giveUp: null,
    at: '2026-12-13T00:00:00.000Z',
  };

  it('reads a sealed settle record', () => {
    expect(parseFailureDetail(good)).toEqual({
      failureClass: 'auth_failed',
      compensate: { policy: 'ask', source: 'catalog' },
      escalate: { target: 'owner', source: 'catalog' },
      retries: 2,
      giveUp: null,
      at: '2026-12-13T00:00:00.000Z',
    });
    expect(parseFailureDetail({ ...good, escalate: null, giveUp: { count: 5 } })?.giveUp).toEqual({ count: 5 });
  });

  it('refuses anything outside the record shape — the audit does not guess', () => {
    expect(parseFailureDetail(null)).toBeNull();
    expect(parseFailureDetail({ ...good, class: 'exploded' })).toBeNull();
    expect(parseFailureDetail({ ...good, compensate: { policy: 'whenever', source: 'catalog' } })).toBeNull();
    expect(parseFailureDetail({ ...good, compensate: { policy: 'ask', source: 'someone' } })).toBeNull();
    expect(parseFailureDetail({ ...good, escalate: { target: 'everyone', source: 'catalog' } })).toBeNull();
    expect(parseFailureDetail({ ...good, retries: -1 })).toBeNull();
    expect(parseFailureDetail({ ...good, giveUp: { count: 0 } })).toBeNull();
    expect(parseFailureDetail({ ...good, at: '' })).toBeNull();
  });
});
