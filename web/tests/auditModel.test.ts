import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  exceptionReason, flowObservation, runOutcome, summarizeDeployment, templateSteps, verifyChain,
  type ChainStep, type WorkflowRunRecord, type WorkflowStepRecord,
} from '@/Function/audit/auditModel';

const sha = async (text: string) => createHash('sha256').update(text).digest('hex');

let seq = 0;
function step(patch: Partial<WorkflowStepRecord>): WorkflowStepRecord {
  seq += 1;
  return {
    id: `s${seq}`, run_id: 'r1', deployment_id: 'd1', step_key: `k${seq}`, kind: 'step', connector: null,
    operation: 'none', result: 'ok', actor_kind: 'ai_agent', actor_name: null, reason: null,
    occurred_at: '2026-10-26T01:00:00Z', duration_ms: null, seq, prev_hash: '', hash: '', ...patch,
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
    hash: '7225e56d3ef43c5afda3a837bf468548d41b9d9a2927ed3f829c6cd2450f1efe', run,
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

  it('keeps field boundaries: moving text between neighbours changes the hash', async () => {
    expect(await verifyChain([{ ...first, actor_name: '受注エージェント|', reason: null }], sha)).toEqual([{ seq: 1, kind: 'hash' }]);
    expect(await verifyChain([{ ...first, actor_name: '受注', reason: 'エージェント' }], sha)).toEqual([{ seq: 1, kind: 'hash' }]);
  });
});
