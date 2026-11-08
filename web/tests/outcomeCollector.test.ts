import { describe, expect, it } from 'vitest';

// Outcome records (B4): the collector (_shared/outcomeCollector.ts)
// derives each finished run's outcome from sealed rows — never from
// model text — fills the human signal once, in the design's strength
// order, and refreshes rollups by recomputation. These tests run the
// real collector over an in-memory store: a fixture set of runs with
// known approvals / acceptances / reopens must produce exactly the
// hand-computed outcome rows and rollup counts, and a second pass over
// the same world must change nothing (idempotence).
const oc = await import(new URL('../../supabase/functions/_shared/outcomeCollector.ts', import.meta.url).pathname);

const NOW = new Date('2026-11-09T00:00:00.000Z');

// ── An in-memory store with the query surface the collector uses ─────
type Row = Record<string, unknown>;

interface Store {
  agent_runs: Row[];
  run_outcomes: Row[];
  agent_actions: Row[];
  elements: Row[];
  strategy_objects: Row[];
  strategies: Row[];
  definitions: Row[];
  element_activity: Row[];
  promotion_drafts: Row[];
  outcome_rollups: Row[];
}

const emptyStore = (): Store => ({
  agent_runs: [], run_outcomes: [], agent_actions: [], elements: [], strategy_objects: [],
  strategies: [], definitions: [], element_activity: [], promotion_drafts: [], outcome_rollups: [],
});

type Filter = { col: string; op: 'eq' | 'in' | 'notnull' | 'gt' | 'gte' | 'lt'; val?: unknown };

const matches = (row: Row, f: Filter): boolean => {
  const v = row[f.col];
  switch (f.op) {
    case 'eq': return v === f.val;
    case 'in': return (f.val as unknown[]).includes(v);
    case 'notnull': return v !== null && v !== undefined;
    case 'gt': return typeof v === 'string' && typeof f.val === 'string' && v > f.val;
    case 'gte': return typeof v === 'string' && typeof f.val === 'string' && v >= f.val;
    case 'lt': return typeof v === 'string' && typeof f.val === 'string' && v < f.val;
  }
};

function fakeAdmin(store: Store) {
  let genCounter = 0;
  return {
    from(table: keyof Store) {
      const rows = store[table];
      let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
      let payload: Row[] | Row | null = null;
      let upsertKeys: string[] = [];
      let ignoreDuplicates = false;
      let selectAfter = false;
      const filters: Filter[] = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitN: number | null = null;

      const exec = (): { data: unknown; error: null } => {
        if (op === 'insert' || op === 'upsert') {
          const incoming = (payload as Row[]).map((r) => ({ ...r }));
          const wrote: Row[] = [];
          for (const row of incoming) {
            const clash = op === 'upsert'
              ? rows.findIndex((r) => upsertKeys.every((k) => r[k] === row[k]))
              : -1;
            if (clash >= 0 && ignoreDuplicates) continue;
            if (clash >= 0) { rows[clash] = { ...rows[clash], ...row }; continue; }
            if (row.id === undefined) row.id = `gen-${++genCounter}`;
            rows.push(row);
            wrote.push(row);
          }
          return { data: selectAfter ? wrote : null, error: null };
        }
        if (op === 'update') {
          const matched = rows.filter((r) => filters.every((f) => matches(r, f)));
          for (const r of matched) Object.assign(r, payload as Row);
          return { data: selectAfter ? matched : null, error: null };
        }
        if (op === 'delete') {
          for (let i = rows.length - 1; i >= 0; i--) {
            if (filters.every((f) => matches(rows[i], f))) rows.splice(i, 1);
          }
          return { data: null, error: null };
        }
        let out = rows.filter((r) => filters.every((f) => matches(r, f)));
        if (orderCol) {
          out = [...out].sort((a, b) => {
            const x = String(a[orderCol!] ?? '');
            const y = String(b[orderCol!] ?? '');
            return (x < y ? -1 : x > y ? 1 : 0) * (orderAsc ? 1 : -1);
          });
        }
        if (limitN !== null) out = out.slice(0, limitN);
        return { data: out.map((r) => ({ ...r })), error: null };
      };

      const qb: Record<string, unknown> = {
        select: () => { selectAfter = true; return qb; },
        insert: (r: Row[]) => { op = 'insert'; payload = r; return qb; },
        upsert: (r: Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
          op = 'upsert'; payload = r; upsertKeys = opts.onConflict.split(',').map((s) => s.trim());
          ignoreDuplicates = !!opts.ignoreDuplicates; return qb;
        },
        update: (p: Row) => { op = 'update'; payload = p; return qb; },
        delete: () => { op = 'delete'; return qb; },
        eq: (col: string, val: unknown) => { filters.push({ col, op: 'eq', val }); return qb; },
        in: (col: string, val: unknown[]) => { filters.push({ col, op: 'in', val }); return qb; },
        not: (col: string, _o: string, val: unknown) => { if (val === null) filters.push({ col, op: 'notnull' }); return qb; },
        gt: (col: string, val: unknown) => { filters.push({ col, op: 'gt', val }); return qb; },
        gte: (col: string, val: unknown) => { filters.push({ col, op: 'gte', val }); return qb; },
        lt: (col: string, val: unknown) => { filters.push({ col, op: 'lt', val }); return qb; },
        order: (col: string, o?: { ascending?: boolean }) => { orderCol = col; orderAsc = o?.ascending !== false; return qb; },
        limit: (n: number) => { limitN = n; return qb; },
        maybeSingle: () => {
          const { data } = exec();
          const list = (data as Row[] | null) ?? [];
          return Promise.resolve({ data: list[0] ?? null, error: null });
        },
        then: (res: (v: unknown) => void, rej: (e: unknown) => void) => Promise.resolve(exec()).then(res, rej),
      };
      return qb;
    },
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────

const verdict = (over: Record<string, unknown> = {}) => ({
  v: 2, result: 'pass', source: 'verifier', model: 'm', gaps: [], revisions: 0,
  checkedAt: '2026-11-08T09:59:00.000Z', outcome: 'completed', reason: null,
  evidence: { verifyStepIdx: 1, artifactIds: [] },
  claims: { total: 2, sourced: 2, stale: 0 }, claimGaps: [], ...over,
});

function makeStore(): Store {
  const s = emptyStore();
  s.definitions.push({ id: 'def-1', enabled: true, source_version: 3 });
  s.elements.push(
    { id: 'el-1', definition_id: 'def-1', object_id: 'obj-1' },
    { id: 'el-2', definition_id: null, object_id: null },
  );
  s.strategy_objects.push({ strategy_id: 'st-1', object_id: 'obj-1' });
  s.strategies.push({ id: 'st-1', definition_id: null });
  s.agent_runs.push(
    { // run-1: execute, verdict pass, one held reading; accepted later.
      id: 'run-1', element_id: 'el-1', strategy_id: null, activity_space_id: 'space-1', mode: 'execute',
      status: 'awaiting_review', verdict: verdict({ revisions: 1 }), cost_usd: 1.5,
      finished_at: '2026-11-08T10:00:00.000Z', rehearsal: false, integration_draft_id: null, promotion_draft_id: null, ai_session_id: null,
      proposed_readings: [{ measureId: 'msr-1', value: 4, applied: false, appliedAt: null, appliedBy: null, heldReason: 'awaiting-acceptance' }],
    },
    { // run-2: execute, verdict fail; a person rejected a write mid-run.
      id: 'run-2', element_id: 'el-1', strategy_id: null, activity_space_id: 'space-1', mode: 'execute',
      status: 'completed', verdict: verdict({ result: 'fail', gaps: ['根拠が不足'], revisions: 3, reason: 'revisions-exhausted' }), cost_usd: 0.25,
      finished_at: '2026-11-07T09:00:00.000Z', rehearsal: false, integration_draft_id: null, promotion_draft_id: null, ai_session_id: null,
      proposed_readings: null,
    },
    { // run-3: a Copilot chat; no verdict, no Element, no human acts.
      id: 'run-3', element_id: null, strategy_id: null, activity_space_id: 'space-1', mode: 'copilot',
      status: 'completed', verdict: null, cost_usd: 0.1,
      finished_at: '2026-11-08T12:00:00.000Z', rehearsal: false, integration_draft_id: null, promotion_draft_id: null, ai_session_id: 'sess-1',
      proposed_readings: null,
    },
    { // run-4: a failed run in another Space; no finish stood.
      id: 'run-4', element_id: 'el-2', strategy_id: null, activity_space_id: 'space-2', mode: 'execute',
      status: 'failed', verdict: null, cost_usd: 0,
      finished_at: '2026-11-05T09:00:00.000Z', rehearsal: false, integration_draft_id: null, promotion_draft_id: null, ai_session_id: null,
      proposed_readings: null,
    },
    { // run-5: execute, verdict pass; its promotion is rolled back later.
      // Finished 15 days out: inside the 28d window, outside the 7d one.
      id: 'run-5', element_id: 'el-1', strategy_id: null, activity_space_id: 'space-1', mode: 'execute',
      status: 'completed', verdict: verdict(), cost_usd: 0.5,
      finished_at: '2026-10-25T09:00:00.000Z', rehearsal: false, integration_draft_id: null, promotion_draft_id: null, ai_session_id: null,
      proposed_readings: null,
    },
  );
  s.agent_actions.push(
    { run_id: 'run-1', status: 'executed', decision_source: null, decided_by: 'user-1', decided_at: '2026-11-08T09:30:00.000Z', integration_id: 'int-gh', tool: 'create_issue' },
    { run_id: 'run-1', status: 'executed', decision_source: 'policy', decided_by: null, decided_at: '2026-11-08T09:40:00.000Z', integration_id: 'int-gh', tool: 'create_issue' },
    { run_id: 'run-2', status: 'rejected', decision_source: null, decided_by: 'user-9', decided_at: '2026-11-07T08:00:00.000Z', integration_id: 'int-gh', tool: 'create_pull_request' },
  );
  // run-2's work was later closed done by a person — an acceptance
  // candidate that must lose to the earlier approval rejection, because
  // the design orders the sources by strength, approval first.
  s.element_activity.push(
    { element_id: 'el-1', kind: 'status', detail: 'review → done', actor_id: 'user-2', created_at: '2026-11-07T20:00:00.000Z' },
  );
  s.promotion_drafts.push(
    { source_run_id: 'run-5', events: [{ kind: 'rolled_back', at: '2026-10-25T20:00:00.000Z', by: 'owner-1' }] },
  );
  return s;
}

const outcomeOf = (s: Store, runId: string) => s.run_outcomes.find((r) => r.run_id === runId);

// ── The settle + signal passes, end to end ────────────────────────────

describe('collectOutcomes', () => {
  it('writes the hand-computed machine halves and the signals that already exist', async () => {
    const s = makeStore();
    // deno-lint-ignore no-explicit-any
    const out = await oc.collectOutcomes(fakeAdmin(s) as any, NOW);
    expect(out.inserted).toBe(5);
    expect(out.signalled).toBe(2); // run-2 (approval) + run-5 (rollback); run-1 not yet

    const o1 = outcomeOf(s, 'run-1')!;
    expect(o1).toMatchObject({
      element_id: 'el-1', strategy_id: 'st-1', activity_space_id: 'space-1', driver: 'execute',
      definition_id: 'def-1', definition_version: 3, outcome: 'completed',
      verdict_result: 'pass', verdict_reason: null, revisions: 1, cost_usd: 1.5,
      approvals_asked: 1, approvals_approved: 1, approvals_rejected: 0, approvals_policy: 1,
      readings_applied: 0, readings_held: 1, human_signal: 'none', signal_source: null,
    });

    const o2 = outcomeOf(s, 'run-2')!;
    expect(o2).toMatchObject({
      outcome: 'completed', verdict_result: 'fail', verdict_reason: 'revisions-exhausted', revisions: 3,
      approvals_asked: 1, approvals_approved: 0, approvals_rejected: 1, approvals_policy: 0,
      human_signal: 'rejected', signal_source: 'approval',
      signal_at: '2026-11-07T08:00:00.000Z', signal_by: 'user-9',
    });

    const o3 = outcomeOf(s, 'run-3')!;
    expect(o3).toMatchObject({
      driver: 'chat', element_id: null, definition_id: null, outcome: 'completed',
      verdict_result: null, human_signal: 'none',
    });

    const o4 = outcomeOf(s, 'run-4')!;
    expect(o4).toMatchObject({ outcome: null, verdict_result: null, human_signal: 'none', activity_space_id: 'space-2' });

    const o5 = outcomeOf(s, 'run-5')!;
    expect(o5).toMatchObject({
      human_signal: 'rejected', signal_source: 'rollback',
      signal_at: '2026-10-25T20:00:00.000Z', signal_by: 'owner-1',
    });
  });

  it('fills acceptance when the close lands the held readings — with their counts', async () => {
    const s = makeStore();
    // deno-lint-ignore no-explicit-any
    await oc.collectOutcomes(fakeAdmin(s) as any, NOW);
    // The person closes el-1 done: the held reading applies (the
    // acceptance path writes applied/appliedAt/appliedBy onto the run)
    // and the status trigger records the close.
    const run1 = s.agent_runs.find((r) => r.id === 'run-1')!;
    run1.proposed_readings = [{ measureId: 'msr-1', value: 4, applied: true, appliedAt: '2026-11-08T15:00:00.000Z', appliedBy: 'user-closer', heldReason: null }];
    s.element_activity.push({ element_id: 'el-1', kind: 'status', detail: 'review → done', actor_id: 'user-closer', created_at: '2026-11-08T15:00:00.000Z' });

    // deno-lint-ignore no-explicit-any
    const out = await oc.collectOutcomes(fakeAdmin(s) as any, NOW);
    expect(out.inserted).toBe(0);
    expect(out.signalled).toBe(1);
    expect(outcomeOf(s, 'run-1')).toMatchObject({
      human_signal: 'accepted', signal_source: 'acceptance',
      signal_at: '2026-11-08T15:00:00.000Z', signal_by: 'user-closer',
      readings_applied: 1, readings_held: 0,
    });
  });

  it('is idempotent: a further pass over the same world changes nothing', async () => {
    const s = makeStore();
    // deno-lint-ignore no-explicit-any
    await oc.collectOutcomes(fakeAdmin(s) as any, NOW);
    const run1 = s.agent_runs.find((r) => r.id === 'run-1')!;
    run1.proposed_readings = [{ measureId: 'msr-1', value: 4, applied: true, appliedAt: '2026-11-08T15:00:00.000Z', appliedBy: 'user-closer', heldReason: null }];
    s.element_activity.push({ element_id: 'el-1', kind: 'status', detail: 'review → done', actor_id: 'user-closer', created_at: '2026-11-08T15:00:00.000Z' });
    // deno-lint-ignore no-explicit-any
    await oc.collectOutcomes(fakeAdmin(s) as any, NOW);

    const before = structuredClone({ outcomes: s.run_outcomes, rollups: s.outcome_rollups });
    // deno-lint-ignore no-explicit-any
    const out = await oc.collectOutcomes(fakeAdmin(s) as any, NOW);
    expect(out).toEqual({ inserted: 0, signalled: 0, rollups: 0 });
    expect({ outcomes: s.run_outcomes, rollups: s.outcome_rollups }).toEqual(before);
  });

  it('leaves a run with no human interaction at none — absence is a value', async () => {
    const s = makeStore();
    // deno-lint-ignore no-explicit-any
    await oc.collectOutcomes(fakeAdmin(s) as any, NOW);
    // deno-lint-ignore no-explicit-any
    await oc.collectOutcomes(fakeAdmin(s) as any, new Date(NOW.getTime() + 30 * 86_400_000));
    expect(outcomeOf(s, 'run-3')).toMatchObject({ human_signal: 'none', signal_source: null, signal_at: null });
  });
});

// ── Signal derivation, piece by piece ─────────────────────────────────

const baseRun = { id: 'r', element_id: 'el', finished_at: '2026-11-08T10:00:00.000Z' };
const noActs = { actions: [], readings: [], activities: [], elementFinishedRuns: [{ id: 'r', finished_at: baseRun.finished_at }], rollbacks: [] };

describe('signalCandidatesOf / pickSignal', () => {
  it('a reopen of auto-closed work is rework (the finish survived every machine gate)', () => {
    const candidates = oc.signalCandidatesOf({
      ...noActs, run: baseRun,
      activities: [{ element_id: 'el', detail: 'done → todo', actor_id: 'user-1', created_at: '2026-11-08T12:00:00.000Z' }],
    });
    expect(oc.pickSignal(candidates)).toEqual({ signal: 'rework', source: 'reopen', at: '2026-11-08T12:00:00.000Z', by: 'user-1' });
  });

  it('a send-back from review is rework, sourced to the review', () => {
    const candidates = oc.signalCandidatesOf({
      ...noActs, run: baseRun,
      activities: [{ element_id: 'el', detail: 'review → in_progress', actor_id: 'user-1', created_at: '2026-11-08T12:00:00.000Z' }],
    });
    expect(oc.pickSignal(candidates)).toMatchObject({ signal: 'rework', source: 'review' });
  });

  it("the run's own finish-time moves never speak (they precede finished_at)", () => {
    const candidates = oc.signalCandidatesOf({
      ...noActs, run: baseRun,
      activities: [{ element_id: 'el', detail: 'todo → review', actor_id: 'user-1', created_at: '2026-11-08T09:59:00.000Z' }],
      readings: [{ measureId: 'm', value: 1, applied: true, appliedAt: '2026-11-08T09:59:30.000Z', appliedBy: 'user-1', heldReason: null }],
    });
    expect(candidates).toEqual([]);
  });

  it('an Element act belongs to the run standing at its time, not an older one', () => {
    const candidates = oc.signalCandidatesOf({
      ...noActs, run: baseRun,
      activities: [{ element_id: 'el', detail: 'review → done', actor_id: 'user-1', created_at: '2026-11-08T20:00:00.000Z' }],
      elementFinishedRuns: [
        { id: 'r', finished_at: '2026-11-08T10:00:00.000Z' },
        { id: 'r2', finished_at: '2026-11-08T18:00:00.000Z' },
      ],
    });
    expect(candidates).toEqual([]);
  });

  it('service-role status changes (no actor) are not a person’s verdict', () => {
    const candidates = oc.signalCandidatesOf({
      ...noActs, run: baseRun,
      activities: [{ element_id: 'el', detail: 'review → done', actor_id: null, created_at: '2026-11-08T12:00:00.000Z' }],
    });
    expect(candidates).toEqual([]);
  });

  it('acceptance outranks a later rollback of the same run’s promotion', () => {
    const candidates = oc.signalCandidatesOf({
      ...noActs, run: baseRun,
      readings: [{ measureId: 'm', value: 1, applied: true, appliedAt: '2026-11-08T12:00:00.000Z', appliedBy: 'user-1', heldReason: null }],
      rollbacks: [{ at: '2026-11-08T18:00:00.000Z', by: 'owner-1' }],
    });
    expect(oc.pickSignal(candidates)).toMatchObject({ signal: 'accepted', source: 'acceptance' });
  });
});

// ── Rollups, hand-computed ────────────────────────────────────────────

describe('rollupRowsOf', () => {
  it('counts the fixture world per scope and window', async () => {
    const s = makeStore();
    // deno-lint-ignore no-explicit-any
    await oc.collectOutcomes(fakeAdmin(s) as any, NOW);
    const roll = (kind: string, id: string, days: number) => s.outcome_rollups.find(
      (r) => r.scope_kind === kind && r.scope_id === id && r.window_start === oc.windowStartOf(NOW, days),
    );

    const space28 = roll('space', 'space-1', 28)!;
    expect(space28.counts).toMatchObject({
      runs: 4, completed: 4, failed: 0,
      verdict_pass: 2, verdict_fail: 1, verdict_none: 1,
      signal_accepted: 0, signal_rejected: 2, signal_none: 2,
      approvals_asked: 2, approvals_approved: 1, approvals_rejected: 1, approvals_policy: 1,
      readings_applied: 0, readings_held: 1, revisions: 4,
    });
    expect((space28.counts as Row).cost_usd).toBeCloseTo(2.35);

    const space7 = roll('space', 'space-1', 7)!;
    expect(space7.counts).toMatchObject({ runs: 3 }); // run-5 finished 2026-10-25, outside the 7d window

    const def28 = roll('definition', 'def-1', 28)!;
    expect(def28.counts).toMatchObject({ runs: 3, verdict_pass: 2, verdict_fail: 1 });

    const cmd = roll('connector_command', 'int-gh:create_issue', 28)!;
    expect(cmd.counts).toMatchObject({ actions: 2, asked: 1, approved: 1, policy: 1, executed: 2, runs: 1 });
    const cmdPr = roll('connector_command', 'int-gh:create_pull_request', 28)!;
    expect(cmdPr.counts).toMatchObject({ actions: 1, asked: 1, rejected: 1, runs: 1 });

    const space2 = roll('space', 'space-2', 28)!;
    expect(space2.counts).toMatchObject({ runs: 1, failed: 1, signal_none: 1 });
  });
});

// ── Pure builders ─────────────────────────────────────────────────────

describe('machineHalfOf', () => {
  it('an unchecked v1 verdict still pairs: outcome and revisions survive, claims are not invented', () => {
    const half = oc.machineHalfOf({
      run: {
        id: 'r', element_id: 'el', strategy_id: null, activity_space_id: 'sp', mode: 'execute', status: 'completed',
        verdict: { v: 1, result: 'unchecked', source: 'none', model: null, gaps: [], revisions: 2, checkedAt: null, outcome: 'completed', reason: 'verify-unavailable', evidence: { verifyStepIdx: null, artifactIds: [] } },
        proposed_readings: null, cost_usd: '0.75', finished_at: '2026-11-08T00:00:00.000Z', rehearsal: false,
      },
      actions: [], definition: null, strategyId: null,
    });
    expect(half).toMatchObject({ outcome: 'completed', verdict_result: 'unchecked', verdict_reason: 'verify-unavailable', revisions: 2, cost_usd: 0.75, definition_id: null });
  });

  it('driver kinds mirror the engine dispatch', () => {
    const base = { element_id: null, strategy_id: null, integration_draft_id: null, promotion_draft_id: null, ai_session_id: null, mode: 'execute' };
    expect(oc.driverKindOf({ ...base, element_id: 'e' })).toBe('execute');
    expect(oc.driverKindOf({ ...base, strategy_id: 's' })).toBe('converse');
    expect(oc.driverKindOf({ ...base, ai_session_id: 'x' })).toBe('chat');
    expect(oc.driverKindOf({ ...base, mode: 'heartbeat' })).toBe('heartbeat');
    expect(oc.driverKindOf(base)).toBe('execute');
  });
});
