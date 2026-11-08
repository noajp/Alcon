import { describe, expect, it } from 'vitest';

// Verifier calibration (B5, _shared/verifierCalibration.ts): pair each
// checked verdict with its run's human signal, count the agreement per
// definition, and open a revision candidate only where the
// disagreement is systematic — at least 10 pairs and one direction's
// error rate at 30%. Below the floor nothing is concluded: these tests
// pin the boundary exactly, the unchecked exclusion the design calls
// out, the write plan's restraint (a quiet evaluation writes nothing),
// and the evaluator shell end to end over an in-memory store.
const cal = await import(new URL('../../supabase/functions/_shared/verifierCalibration.ts', import.meta.url).pathname);
const snap = await import(new URL('../../supabase/functions/_shared/heartbeatSnapshot.ts', import.meta.url).pathname);

const NOW = new Date('2026-11-09T00:00:00.000Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

type Fact = {
  id: string; activitySpaceId: string | null; definitionId: string | null;
  verdictResult: 'pass' | 'fail' | 'unchecked' | null;
  humanSignal: 'accepted' | 'rejected' | 'rework' | 'none';
  finishedAt: string;
};
let seq = 0;
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: `o${++seq}`, activitySpaceId: 's1', definitionId: 'd1',
  verdictResult: 'pass', humanSignal: 'accepted', finishedAt: daysAgo(2), ...over,
});
const pairs = (n: number, over: Partial<Fact>): Fact[] => Array.from({ length: n }, () => fact(over));

describe('pairClassOf — the pairing', () => {
  it('pairs agreement and both disagreement directions', () => {
    expect(cal.pairClassOf('pass', 'accepted')).toBe('agree_pass');
    expect(cal.pairClassOf('pass', 'rejected')).toBe('false_pass');
    expect(cal.pairClassOf('pass', 'rework')).toBe('false_pass');
    expect(cal.pairClassOf('fail', 'accepted')).toBe('false_fail');
    expect(cal.pairClassOf('fail', 'rejected')).toBe('agree_fail');
    expect(cal.pairClassOf('fail', 'rework')).toBe('agree_fail');
  });

  it('never pairs an unchecked verdict or a silent human', () => {
    expect(cal.pairClassOf('unchecked', 'accepted')).toBeNull();
    expect(cal.pairClassOf('unchecked', 'rejected')).toBeNull();
    expect(cal.pairClassOf(null, 'accepted')).toBeNull();
    expect(cal.pairClassOf('pass', 'none')).toBeNull();
    expect(cal.pairClassOf('fail', 'none')).toBeNull();
  });
});

describe('calibrationCountsOf', () => {
  it('counts pairs per definition and Space, keeping the disagreeing ids newest first', () => {
    const facts = [
      ...pairs(2, { verdictResult: 'pass', humanSignal: 'accepted' }),
      fact({ verdictResult: 'pass', humanSignal: 'rejected', finishedAt: daysAgo(1) }),
      fact({ verdictResult: 'pass', humanSignal: 'rework', finishedAt: daysAgo(3) }),
      fact({ verdictResult: 'fail', humanSignal: 'accepted', finishedAt: daysAgo(1) }),
      fact({ definitionId: 'd2', verdictResult: 'fail', humanSignal: 'rejected' }),
      fact({ activitySpaceId: 's2', verdictResult: 'pass', humanSignal: 'accepted' }),
    ];
    const out = cal.calibrationCountsOf(facts);
    expect(out.map((g: { definitionId: string }) => g.definitionId)).toEqual(['d1', 'd1', 'd2']);
    const d1s1 = out.find((g: { definitionId: string; activitySpaceId: string }) => g.definitionId === 'd1' && g.activitySpaceId === 's1');
    expect(d1s1).toMatchObject({ agreePass: 2, agreeFail: 0, falsePass: 2, falseFail: 1, pairs: 5 });
    expect(d1s1.falsePassIds).toHaveLength(2);
    expect(d1s1.falsePassIds[0]).toBe(facts[2].id); // the newer false pass first
  });

  it('a definition whose finishes are always accepted unchecked accrues no pairs', () => {
    const facts = [
      ...pairs(12, { verdictResult: 'unchecked', humanSignal: 'accepted' }),
      ...pairs(4, { verdictResult: 'pass', humanSignal: 'none' }),
      fact({ definitionId: null }),
      fact({ activitySpaceId: null }),
    ];
    expect(cal.calibrationCountsOf(facts)).toEqual([]);
  });

  it('caps the kept sample ids at the policy limit', () => {
    const facts = pairs(25, { verdictResult: 'pass', humanSignal: 'rejected' });
    const [g] = cal.calibrationCountsOf(facts);
    expect(g.falsePass).toBe(25);
    expect(g.falsePassIds).toHaveLength(cal.CALIBRATION_POLICY.sampleLimit);
  });
});

describe('candidateDraftOf — the candidate rule at its boundary', () => {
  type CountsLike = {
    activitySpaceId: string; definitionId: string;
    agreePass: number; agreeFail: number; falsePass: number; falseFail: number; pairs: number;
    falsePassIds: string[]; falseFailIds: string[];
  };
  const counts = (over: Partial<CountsLike>): CountsLike => ({
    activitySpaceId: 's1', definitionId: 'd1',
    agreePass: 0, agreeFail: 0, falsePass: 0, falseFail: 0, pairs: 0,
    falsePassIds: [], falseFailIds: [], ...over,
  });

  it('opens at exactly 10 pairs and exactly 30% one-directional error', () => {
    const ids = ['a', 'b', 'c'];
    const draft = cal.candidateDraftOf(counts({ pairs: 10, agreePass: 7, falsePass: 3, falsePassIds: ids }));
    expect(draft).toEqual({ reason: 'false_pass_heavy', rate: 0.3, pairs: 10, sampleOutcomeIds: ids });
  });

  it('one pair below the floor opens none, however skewed', () => {
    expect(cal.candidateDraftOf(counts({ pairs: 9, falsePass: 9 }))).toBeNull();
  });

  it('under the rate in both directions opens none', () => {
    expect(cal.candidateDraftOf(counts({ pairs: 10, agreePass: 6, falsePass: 2, falseFail: 2 }))).toBeNull();
  });

  it('the larger direction names the bias; a tie names false-pass-heavy', () => {
    expect(cal.candidateDraftOf(counts({ pairs: 10, falsePass: 3, falseFail: 4 }))?.reason).toBe('false_fail_heavy');
    expect(cal.candidateDraftOf(counts({ pairs: 10, falsePass: 4, falseFail: 3 }))?.reason).toBe('false_pass_heavy');
    expect(cal.candidateDraftOf(counts({ pairs: 10, falsePass: 3, falseFail: 3 }))?.reason).toBe('false_pass_heavy');
    expect(cal.candidateDraftOf(counts({ pairs: 10, falsePass: 3, falseFail: 4 }))?.rate).toBe(0.4);
  });
});

describe('candidateWritesOf — the write plan', () => {
  const counts = (over: Record<string, unknown> = {}) => ({
    activitySpaceId: 's1', definitionId: 'd1',
    agreePass: 7, agreeFail: 0, falsePass: 3, falseFail: 0, pairs: 10,
    falsePassIds: ['x', 'y', 'z'], falseFailIds: [] as string[], ...over,
  });
  const open = (over: Record<string, unknown> = {}) => ({
    id: 'c1', definitionId: 'd1', activitySpaceId: 's1', reason: 'false_pass_heavy',
    rate: 0.3, pairs: 10, sampleOutcomeIds: ['x', 'y', 'z'], createdAt: daysAgo(1), ...over,
  });

  it('inserts when over the rule with none open', () => {
    const plan = cal.candidateWritesOf([], [counts()]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([{
      definition_id: 'd1', activity_space_id: 's1', reason: 'false_pass_heavy',
      rate: 0.3, pairs: 10, sample_outcome_ids: ['x', 'y', 'z'],
    }]);
  });

  it('plans nothing when the open candidate already wears the current numbers', () => {
    expect(cal.candidateWritesOf([open()], [counts()])).toEqual({ inserts: [], updates: [] });
  });

  it('refreshes a drifted candidate to the fresh draft', () => {
    const plan = cal.candidateWritesOf([open()], [counts({ pairs: 20, agreePass: 12, falsePass: 8, falsePassIds: ['n1'] })]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'c1', reason: 'false_pass_heavy', rate: 0.4, pairs: 20, sample_outcome_ids: ['n1'] }]);
  });

  it('below the rule the stored reason stands and its own rate refreshes', () => {
    const plan = cal.candidateWritesOf([open()], [counts({ pairs: 20, agreePass: 17, falsePass: 3, falsePassIds: ['x'] })]);
    expect(plan.updates).toEqual([{ id: 'c1', reason: 'false_pass_heavy', rate: 0.15, pairs: 20, sample_outcome_ids: ['x'] }]);
  });

  it('never touches a gap_cluster candidate, nor one whose pairs left the window', () => {
    expect(cal.candidateWritesOf([open({ reason: 'gap_cluster' })], [counts()])).toEqual({ inserts: [], updates: [] });
    expect(cal.candidateWritesOf([open()], [])).toEqual({ inserts: [], updates: [] });
  });
});

describe('calibrationCandidateSignals — the heartbeat surface', () => {
  const names = new Map([['d1', '請求書の送付']]);

  it('fingerprints by candidate id and names the bias with its numbers', () => {
    const [s] = cal.calibrationCandidateSignals(
      [{ id: 'c1', definitionId: 'd1', reason: 'false_pass_heavy', rate: 0.3, pairs: 10, createdAt: daysAgo(2) }], names);
    expect(s.kind).toBe('calibration_candidate');
    expect(snap.fingerprintOf(s)).toBe('calibration:c1');
    expect(s.since).toBe(daysAgo(2));
    expect(s.label).toContain('請求書の送付');
    expect(s.label).toContain('3 件');
    expect(s.label).toContain('30%');
    expect(snap.HEARTBEAT_KIND_LABEL.calibration_candidate).toBe('定義の見直し候補');
  });

  it('the strict direction reads the other way', () => {
    const [s] = cal.calibrationCandidateSignals(
      [{ id: 'c2', definitionId: 'd1', reason: 'false_fail_heavy', rate: 0.4, pairs: 10, createdAt: daysAgo(2) }], names);
    expect(s.label).toContain('厳しめ');
    expect(s.label).toContain('4 件');
  });

  it('a candidate enters the snapshot once and is deduped the next wake', () => {
    const signals = cal.calibrationCandidateSignals(
      [{ id: 'c1', definitionId: 'd1', reason: 'false_pass_heavy', rate: 0.3, pairs: 10, createdAt: daysAgo(2) }], names);
    const first = snap.buildHeartbeatSnapshot(signals, { now: NOW, thresholdHours: 24, previousFingerprints: [] });
    expect(first.candidates.map((c: { signalId: string }) => c.signalId)).toEqual(['calibration:c1']);
    const second = snap.buildHeartbeatSnapshot(signals, { now: NOW, thresholdHours: 24, previousFingerprints: ['calibration:c1'] });
    expect(second.candidates).toEqual([]);
    expect(second.silenced).toBe(1);
  });
});

// ── The evaluator over an in-memory store ────────────────────────────

type Row = Record<string, unknown>;
interface Store { run_outcomes: Row[]; verifier_calibration: Row[]; definition_revision_candidates: Row[] }

type Filter = { col: string; op: 'eq' | 'in' | 'neq' | 'gte' | 'lt' | 'notnull'; val?: unknown };
const matches = (row: Row, f: Filter): boolean => {
  const v = row[f.col];
  switch (f.op) {
    case 'eq': return v === f.val;
    case 'in': return (f.val as unknown[]).includes(v as never);
    case 'neq': return v !== f.val;
    case 'gte': return typeof v === 'string' && typeof f.val === 'string' && v >= f.val;
    case 'lt': return typeof v === 'string' && typeof f.val === 'string' && v < f.val;
    case 'notnull': return v !== null && v !== undefined;
  }
};

function fakeAdmin(store: Store) {
  let gen = 0;
  const from = (table: keyof Store) => {
    const rows = store[table];
    let op: 'select' | 'upsert' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | Row[] | null = null;
    let conflictKeys: string[] = [];
    const filters: Filter[] = [];
    const orders: { col: string; ascending: boolean }[] = [];
    let limitN: number | null = null;
    const applyFilters = (list: Row[]) => list.filter((r) => filters.every((f) => matches(r, f)));
    const run = (): { data: unknown; error: unknown } => {
      if (op === 'select') {
        let out = applyFilters([...rows]);
        for (const o of orders) out.sort((a, b) => String(a[o.col]).localeCompare(String(b[o.col])) * (o.ascending ? 1 : -1));
        if (limitN !== null) out = out.slice(0, limitN);
        return { data: out, error: null };
      }
      if (op === 'upsert') {
        for (const row of payload as Row[]) {
          const at = rows.findIndex((r) => conflictKeys.every((k) => r[k] === row[k]));
          if (at >= 0) rows[at] = { ...rows[at], ...row };
          else rows.push({ id: `gen${++gen}`, ...row });
        }
        return { data: null, error: null };
      }
      if (op === 'insert') {
        const row = payload as Row;
        if (table === 'definition_revision_candidates'
          && rows.some((r) => r.definition_id === row.definition_id && r.status === 'open')) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } };
        }
        rows.push({ id: `gen${++gen}`, status: 'open', created_at: daysAgo(0), updated_at: daysAgo(0), ...row });
        return { data: null, error: null };
      }
      if (op === 'update') {
        const hit = applyFilters(rows);
        for (const r of hit) Object.assign(r, payload as Row);
        return { data: hit[0] ? { id: hit[0].id } : null, error: null };
      }
      const kept = rows.filter((r) => !filters.every((f) => matches(r, f)));
      rows.length = 0; rows.push(...kept);
      return { data: null, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      not: (col: string) => { filters.push({ col, op: 'notnull' }); return q; },
      in: (col: string, val: unknown) => { filters.push({ col, op: 'in', val }); return q; },
      neq: (col: string, val: unknown) => { filters.push({ col, op: 'neq', val }); return q; },
      gte: (col: string, val: unknown) => { filters.push({ col, op: 'gte', val }); return q; },
      lt: (col: string, val: unknown) => { filters.push({ col, op: 'lt', val }); return q; },
      eq: (col: string, val: unknown) => { filters.push({ col, op: 'eq', val }); return q; },
      order: (col: string, o: { ascending: boolean }) => { orders.push({ col, ascending: o.ascending }); return q; },
      limit: (n: number) => { limitN = n; return q; },
      upsert: (r: Row[], opts: { onConflict: string }) => { op = 'upsert'; payload = r; conflictKeys = opts.onConflict.split(','); return q; },
      insert: (r: Row) => { op = 'insert'; payload = r; return q; },
      update: (p: Row) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      maybeSingle: () => Promise.resolve({ data: (run().data as { id: string } | null) ?? null }),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(run()).then(res, rej),
    };
    return q;
  };
  return { from };
}

const outcomeRow = (f: Fact): Row => {
  return {
    id: f.id, activity_space_id: f.activitySpaceId, definition_id: f.definitionId,
    verdict_result: f.verdictResult, human_signal: f.humanSignal, finished_at: f.finishedAt,
  };
};

describe('evaluateCalibration — the tick evaluator', () => {
  const seedWorld = (): Store => {
    const store: Store = { run_outcomes: [], verifier_calibration: [], definition_revision_candidates: [] };
    // d1: exactly at the boundary — 10 pairs, 3 false passes.
    store.run_outcomes.push(
      ...pairs(7, { verdictResult: 'pass', humanSignal: 'accepted' }).map((f) => outcomeRow(f)),
      ...pairs(3, { verdictResult: 'pass', humanSignal: 'rejected' }).map((f) => outcomeRow(f)),
      // Noise that must never pair: unchecked finishes, silent runs, an old pair.
      ...pairs(5, { verdictResult: 'unchecked', humanSignal: 'accepted' }).map((f) => outcomeRow(f)),
      outcomeRow(fact({ verdictResult: 'pass', humanSignal: 'rejected', finishedAt: daysAgo(40) })),
    );
    // d2: 9 pairs, skewed but below the floor — a rollup row, no candidate.
    store.run_outcomes.push(
      ...pairs(9, { definitionId: 'd2', verdictResult: 'pass', humanSignal: 'rejected' }).map((f) => outcomeRow(f)),
    );
    // d3: 12 pairs, 5 false fails — the strict direction.
    store.run_outcomes.push(
      ...pairs(7, { definitionId: 'd3', verdictResult: 'fail', humanSignal: 'rejected' }).map((f) => outcomeRow(f)),
      ...pairs(5, { definitionId: 'd3', verdictResult: 'fail', humanSignal: 'accepted' }).map((f) => outcomeRow(f)),
    );
    return store;
  };

  it('opens candidates at the boundary and only there; a re-run changes nothing', async () => {
    const store = seedWorld();
    const admin = fakeAdmin(store) as never;
    const first = await cal.evaluateCalibration(admin, NOW);
    expect(first).toEqual({ calibrationRows: 3, opened: 2, refreshed: 0 });

    const cal1 = store.verifier_calibration.find((r) => r.definition_id === 'd1');
    expect(cal1).toMatchObject({ agree_pass: 7, false_pass: 3, false_fail: 0, pairs: 10, window_days: 28 });
    const cand1 = store.definition_revision_candidates.find((r) => r.definition_id === 'd1');
    expect(cand1).toMatchObject({ reason: 'false_pass_heavy', rate: 0.3, pairs: 10, status: 'open' });
    expect(cand1?.sample_outcome_ids).toHaveLength(3);
    expect(store.definition_revision_candidates.find((r) => r.definition_id === 'd2')).toBeUndefined();
    expect(store.definition_revision_candidates.find((r) => r.definition_id === 'd3'))
      .toMatchObject({ reason: 'false_fail_heavy', rate: 0.4167, pairs: 12 });

    const again = await cal.evaluateCalibration(admin, NOW);
    expect(again).toEqual({ calibrationRows: 3, opened: 0, refreshed: 0 });
    expect(store.definition_revision_candidates).toHaveLength(2);
  });

  it('refreshes an open candidate as its window drifts below the rule, and never auto-closes it', async () => {
    const store = seedWorld();
    const admin = fakeAdmin(store) as never;
    await cal.evaluateCalibration(admin, NOW);
    store.run_outcomes.push(
      ...pairs(10, { verdictResult: 'pass', humanSignal: 'accepted', finishedAt: daysAgo(1) }).map((f) => outcomeRow(f)),
    );
    const out = await cal.evaluateCalibration(admin, NOW);
    expect(out.opened).toBe(0);
    expect(out.refreshed).toBe(1);
    expect(store.definition_revision_candidates.find((r) => r.definition_id === 'd1'))
      .toMatchObject({ status: 'open', reason: 'false_pass_heavy', rate: 0.15, pairs: 20 });
  });

  it('a candidate opened after a dismissal is a new row (a new wait), the dismissed one untouched', async () => {
    const store = seedWorld();
    const admin = fakeAdmin(store) as never;
    await cal.evaluateCalibration(admin, NOW);
    const dismissed = store.definition_revision_candidates.find((r) => r.definition_id === 'd3');
    dismissed!.status = 'dismissed';
    const out = await cal.evaluateCalibration(admin, NOW);
    expect(out.opened).toBe(1);
    const d3 = store.definition_revision_candidates.filter((r) => r.definition_id === 'd3');
    expect(d3).toHaveLength(2);
    expect(d3.filter((r) => r.status === 'open')).toHaveLength(1);
    expect(d3.filter((r) => r.status === 'dismissed')).toHaveLength(1);
  });
});
