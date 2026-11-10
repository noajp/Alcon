// The Evaluation tab's aggregation, pinned: the tab is only as honest
// as this model. The load-bearing rules under test:
//   - attribution is BY ELEMENT SET, never by run_outcomes.strategy_id
//     (deliberately null for multi-Strategy runs — those outcomes are
//     represented here exactly as the collector leaves them: an
//     element_id and no usable strategy attribution);
//   - a rate exists only at denominator >= 5 — below that, counts only;
//   - unchecked finishes are counted and named, never folded into the
//     pass rate, and unsignalled outcomes are not agreement;
//   - per-Object rows are worst-first by the named key (send-back rate,
//     then fail rate, then finishes), and an Element in two Objects is
//     counted once in the headline and once in the partition.

import { describe, expect, it } from 'vitest';
import {
  buildEvaluation,
  rateOf,
  trendBuckets,
  type EvaluationInputs,
  type EvaluationOutcomeRow,
  type EvaluationRunRow,
} from '@/ActivitySpace/strategy/initiative/evaluationModel';
import type { FailureDetail } from '@/Function/audit/auditModel';
import type { DefinitionRevisionCandidate, DefinitionTest, VerifierCalibration } from '@/types/database';

const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function outcome(over: Partial<EvaluationOutcomeRow> = {}): EvaluationOutcomeRow {
  seq += 1;
  return {
    id: `o${seq}`,
    run_id: `r${seq}`,
    element_id: 'e1',
    definition_id: null,
    outcome: 'completed',
    verdict_result: 'pass',
    human_signal: 'none',
    revisions: 0,
    cost_usd: 1,
    readings_applied: 0,
    readings_held: 0,
    finished_at: iso(NOW - DAY),
    ...over,
  };
}

function failureDetail(failureClass: string): FailureDetail {
  return {
    failureClass,
    compensate: { policy: 'ask', source: 'default' },
    escalate: null,
    retries: 0,
    giveUp: null,
    at: iso(NOW - DAY),
  };
}

function run(over: Partial<EvaluationRunRow> & { id: string }): EvaluationRunRow {
  return {
    element_id: 'e1',
    status: 'completed',
    finished_at: iso(NOW - DAY),
    verdict: null,
    finishDetail: null,
    failureDetail: null,
    ...over,
  };
}

const OBJECTS: EvaluationInputs['objects'] = [
  { id: 'obj1', name: 'Alpha', elements: [{ id: 'e1', title: 'First' }, { id: 'e2', title: 'Second' }] },
  { id: 'obj2', name: 'Beta', elements: [{ id: 'e3', title: 'Third' }] },
];

function build(over: Partial<EvaluationInputs> = {}) {
  return buildEvaluation({
    objects: OBJECTS,
    outcomes: [],
    runs: [],
    artifacts: [],
    calibrations: [],
    candidates: [],
    tests: [],
    definitionNames: {},
    period: '28d',
    now: NOW,
    ...over,
  });
}

describe('element-set attribution', () => {
  it('counts outcomes by element_id alone — a multi-Strategy run (strategy_id null in the collector) is not lost', () => {
    // The row type carries no strategy_id at all: attribution cannot
    // consult it. These outcomes stand in for runs whose element serves
    // two Strategies and whose stored strategy_id is therefore null.
    const report = build({
      outcomes: [
        outcome({ element_id: 'e1' }),
        outcome({ element_id: 'e2' }),
        outcome({ element_id: 'e3' }),
      ],
    });
    expect(report.headline.finishes).toBe(3);
    expect(report.outOfScope).toBe(0);
  });

  it('excludes outcomes on Elements outside the Strategy, and element-less outcomes', () => {
    const report = build({
      outcomes: [
        outcome({ element_id: 'e1' }),
        outcome({ element_id: 'elsewhere' }),
        outcome({ element_id: null }),
      ],
    });
    expect(report.headline.finishes).toBe(1);
    expect(report.outOfScope).toBe(2);
  });

  it('filters by period: before the start is out, at the start is in', () => {
    const start = NOW - 28 * DAY;
    const report = build({
      outcomes: [
        outcome({ element_id: 'e1', finished_at: iso(start - 1) }),
        outcome({ element_id: 'e1', finished_at: iso(start) }),
        outcome({ element_id: 'e1', finished_at: iso(NOW) }),
      ],
    });
    expect(report.headline.finishes).toBe(2);
  });

  it('an Element in two Objects counts once in the headline and once in the partition', () => {
    const shared: EvaluationInputs['objects'] = [
      { id: 'obj1', name: 'Alpha', elements: [{ id: 'e1', title: 'Shared' }] },
      { id: 'obj2', name: 'Beta', elements: [{ id: 'e1', title: 'Shared' }, { id: 'e3', title: 'Third' }] },
    ];
    const report = build({
      objects: shared,
      outcomes: [outcome({ element_id: 'e1' }), outcome({ element_id: 'e1' }), outcome({ element_id: 'e3' })],
    });
    expect(report.headline.finishes).toBe(3);
    // Partitioned under the FIRST Object that carries the shared Element,
    // so the Object rows sum to the headline instead of double-counting.
    const byId = new Map(report.objects.map((o) => [o.objectId, o.finishes]));
    expect(byId.get('obj1')).toBe(2);
    expect(byId.get('obj2')).toBe(1);
    expect(report.objects.reduce((n, o) => n + o.finishes, 0)).toBe(report.headline.finishes);
  });
});

describe('headline math and denominator discipline', () => {
  it('splits finishes and keeps unchecked (incl. no-verdict) out of the pass-rate denominator', () => {
    const outcomes = [
      ...Array.from({ length: 6 }, () => outcome({ verdict_result: 'pass' })),
      ...Array.from({ length: 4 }, () => outcome({ verdict_result: 'fail', outcome: 'completed' })),
      outcome({ verdict_result: 'unchecked', outcome: 'partial' }),
      outcome({ verdict_result: null, outcome: 'blocked' }),
      outcome({ verdict_result: 'unchecked', outcome: 'partial' }),
    ];
    const h = build({ outcomes }).headline;
    expect(h.finishes).toBe(13);
    expect(h.completed).toBe(10);
    expect(h.partial).toBe(2);
    expect(h.blocked).toBe(1);
    expect(h.pass).toBe(6);
    expect(h.fail).toBe(4);
    expect(h.unchecked).toBe(3);
    expect(h.passRate).toEqual({ numerator: 6, denominator: 10, rate: 0.6 });
  });

  it('withholds rates below n=5 and shows them at n=5', () => {
    expect(rateOf(3, 4).rate).toBeNull();
    expect(rateOf(3, 5).rate).toBe(0.6);
    expect(rateOf(0, 0).rate).toBeNull();
    const four = build({
      outcomes: Array.from({ length: 4 }, () => outcome({ verdict_result: 'pass' })),
    }).headline;
    expect(four.passRate.denominator).toBe(4);
    expect(four.passRate.rate).toBeNull();
    const five = build({
      outcomes: Array.from({ length: 5 }, () => outcome({ verdict_result: 'pass' })),
    }).headline;
    expect(five.passRate.rate).toBe(1);
  });

  it('counts human signals over signalled outcomes only; none is a value, not agreement', () => {
    const outcomes = [
      ...Array.from({ length: 3 }, () => outcome({ human_signal: 'accepted' })),
      outcome({ human_signal: 'rejected' }),
      outcome({ human_signal: 'rework' }),
      ...Array.from({ length: 7 }, () => outcome({ human_signal: 'none' })),
    ];
    const h = build({ outcomes }).headline;
    expect(h.accepted).toBe(3);
    expect(h.rejected).toBe(1);
    expect(h.rework).toBe(1);
    expect(h.unsignalled).toBe(7);
    expect(h.agreementRate).toEqual({ numerator: 3, denominator: 5, rate: 0.6 });
    expect(h.sendBackRate).toEqual({ numerator: 1, denominator: 5, rate: 0.2 });
  });

  it('cost per accepted finish divides total spend by accepted only; null when none accepted', () => {
    const h = build({
      outcomes: [
        outcome({ human_signal: 'accepted', cost_usd: 10 }),
        outcome({ human_signal: 'accepted', cost_usd: 10 }),
        outcome({ human_signal: 'rework', cost_usd: 10 }),
      ],
    }).headline;
    expect(h.costUsd).toBe(30);
    expect(h.costPerAccepted).toBe(15);
    const none = build({ outcomes: [outcome({ cost_usd: 5 })] }).headline;
    expect(none.costPerAccepted).toBeNull();
  });
});

describe('failure mix', () => {
  it('counts B13 classes from the parsed run records, most frequent first', () => {
    const outcomes = [outcome({}), outcome({}), outcome({}), outcome({})];
    const runs = [
      run({ id: outcomes[0].run_id, failureDetail: failureDetail('auth_failed') }),
      run({ id: outcomes[1].run_id, failureDetail: failureDetail('auth_failed') }),
      run({ id: outcomes[2].run_id, failureDetail: failureDetail('rate_limited') }),
      run({ id: outcomes[3].run_id }),
    ];
    const h = build({ outcomes, runs }).headline;
    expect(h.failureMix).toEqual([
      { failureClass: 'auth_failed', count: 2 },
      { failureClass: 'rate_limited', count: 1 },
    ]);
    expect(h.topFailure).toEqual({ failureClass: 'auth_failed', count: 2 });
    expect(h.failedFinishes).toBe(3);
  });
});

describe('worst-first ordering', () => {
  it('orders Objects by send-back rate, then fail rate, then finishes; empty Objects last', () => {
    const objects: EvaluationInputs['objects'] = [
      { id: 'calm', name: 'Calm', elements: [{ id: 'ec', title: 'Calm el' }] },
      { id: 'empty', name: 'Empty', elements: [{ id: 'ee', title: 'Empty el' }] },
      { id: 'failing', name: 'Failing', elements: [{ id: 'ef', title: 'Failing el' }] },
      { id: 'sentback', name: 'Sent back', elements: [{ id: 'es', title: 'Sent back el' }] },
    ];
    const outcomes = [
      // sentback: send-back rate 1 (2 rework of 2 signalled)
      outcome({ element_id: 'es', human_signal: 'rework' }),
      outcome({ element_id: 'es', human_signal: 'rework' }),
      // failing: no signals, fail rate 0.8
      ...Array.from({ length: 4 }, () => outcome({ element_id: 'ef', verdict_result: 'fail' })),
      outcome({ element_id: 'ef', verdict_result: 'pass' }),
      // calm: many finishes, all passing and accepted
      ...Array.from({ length: 9 }, () => outcome({ element_id: 'ec', human_signal: 'accepted' })),
    ];
    const report = build({ objects, outcomes });
    expect(report.objects.map((o) => o.objectId)).toEqual(['sentback', 'failing', 'calm', 'empty']);
  });
});

describe('per-Element drill and worst runs', () => {
  it('lists worst runs newest first — failed, reworked, failure-classed, unchecked — and leaves clean passes out', () => {
    const clean = outcome({ element_id: 'e1', human_signal: 'accepted', finished_at: iso(NOW - DAY) });
    const failed = outcome({ element_id: 'e1', verdict_result: 'fail', finished_at: iso(NOW - 2 * DAY) });
    const reworked = outcome({ element_id: 'e1', human_signal: 'rework', finished_at: iso(NOW - 3 * DAY) });
    const unchecked = outcome({ element_id: 'e1', verdict_result: 'unchecked', finished_at: iso(NOW - 4 * DAY) });
    const report = build({ outcomes: [clean, failed, reworked, unchecked] });
    const el = report.objects.flatMap((o) => o.elements).find((e) => e.elementId === 'e1')!;
    expect(el.finishes).toBe(4);
    expect(el.worstRuns.map((r) => r.runId)).toEqual([failed.run_id, reworked.run_id, unchecked.run_id]);
    expect(el.worstRuns[0].reasons).toContain('verdict-fail');
    expect(el.worstRuns[1].reasons).toContain('rework');
    expect(el.worstRuns[2].reasons).toEqual(['unchecked']);
  });

  it('caps worst runs at 10 per Element', () => {
    const outcomes = Array.from({ length: 14 }, (_, i) =>
      outcome({ element_id: 'e1', verdict_result: 'fail', finished_at: iso(NOW - (i + 1) * 3_600_000) }));
    const report = build({ outcomes });
    const el = report.objects.flatMap((o) => o.elements).find((e) => e.elementId === 'e1')!;
    expect(el.worstRuns).toHaveLength(10);
  });
});

describe('trend bucketing', () => {
  it('buckets 28d by day, at the period edges', () => {
    const todayStart = Math.floor(NOW / DAY) * DAY;
    const outcomes = [
      outcome({ finished_at: iso(todayStart), verdict_result: 'pass' }),
      outcome({ finished_at: iso(todayStart), verdict_result: 'fail', human_signal: 'rework' }),
      outcome({ finished_at: iso(todayStart - 27 * DAY), verdict_result: 'unchecked' }),
    ];
    const buckets = trendBuckets(outcomes, '28d', NOW);
    expect(buckets).toHaveLength(28);
    expect(buckets[0].key).toBe(iso(todayStart - 27 * DAY).slice(0, 10));
    expect(buckets[0]).toMatchObject({ finishes: 1, unchecked: 1 });
    expect(buckets[27]).toMatchObject({ finishes: 2, pass: 1, fail: 1, sendBacks: 1 });
  });

  it('buckets 90d by week and All from the earliest finish', () => {
    const outcomes = [
      outcome({ finished_at: iso(NOW - 20 * DAY) }),
      outcome({ finished_at: iso(NOW - DAY) }),
    ];
    const weekly = trendBuckets(outcomes, '90d', NOW);
    expect(weekly.length).toBeGreaterThan(10);
    expect(weekly.reduce((n, b) => n + b.finishes, 0)).toBe(2);
    expect(trendBuckets([], 'all', NOW)).toEqual([]);
    const all = trendBuckets(outcomes, 'all', NOW);
    expect(all[0].key).toBe(iso(NOW - 20 * DAY).slice(0, 10));
    expect(all.reduce((n, b) => n + b.finishes, 0)).toBe(2);
  });
});

describe('definitions at work', () => {
  const calibration = (over: Partial<VerifierCalibration> = {}): VerifierCalibration => ({
    id: 'cal1', activity_space_id: 'sp1', definition_id: 'd1', window_start: iso(NOW - 28 * DAY),
    window_days: 28, agree_pass: 6, agree_fail: 2, false_pass: 1, false_fail: 1, pairs: 10,
    updated_at: iso(NOW), ...over,
  });
  const candidate = (over: Partial<DefinitionRevisionCandidate> = {}): DefinitionRevisionCandidate => ({
    id: 'cand1', definition_id: 'd1', activity_space_id: 'sp1', reason: 'false_pass_heavy',
    rate: 0.4, pairs: 10, sample_outcome_ids: [], status: 'open',
    created_at: iso(NOW - DAY), updated_at: iso(NOW - DAY), ...over,
  });
  const testRow = (over: Partial<DefinitionTest> = {}): DefinitionTest => ({
    id: 't1', definition_id: 'd1', activity_space_id: 'sp1', name: 'test', fixture: {}, expected: {},
    source_run_id: null, source_run_label: null, source_run_status: null, tainted: false,
    captured_by: null, captured_at: iso(NOW - DAY),
    last_result: { outcome: 'pass', classification: 'completed', expectedClassification: 'completed', consumed: 3, total: 3, at: iso(NOW - DAY) },
    last_run_id: null, last_run_at: iso(NOW - DAY), last_body_hash: 'h', ...over,
  });

  it('joins calibration, the open candidate and test state for definitions the runs used', () => {
    const report = build({
      outcomes: [outcome({ definition_id: 'd1' }), outcome({ definition_id: 'd1', verdict_result: 'fail' })],
      calibrations: [calibration()],
      candidates: [candidate()],
      tests: [
        testRow({ id: 't1' }),
        testRow({ id: 't2', captured_at: iso(NOW - 120 * DAY) }), // fixture older than 90d: stale
        testRow({ id: 't3', last_result: null }), // never run: stale, not passing
      ],
      definitionNames: { d1: 'Claim handler' },
    });
    expect(report.definitions).toHaveLength(1);
    const d = report.definitions[0];
    expect(d.name).toBe('Claim handler');
    expect(d.finishes).toBe(2);
    expect(d.calibration).toEqual({ agree: 8, falsePass: 1, falseFail: 1, pairs: 10, windowDays: 28 });
    expect(d.candidate?.reason).toBe('false_pass_heavy');
    expect(d.tests).toEqual({ total: 3, passing: 1, failing: 0, stale: 2 });
  });

  it('a definition with no pairs shows no calibration summary', () => {
    const report = build({
      outcomes: [outcome({ definition_id: 'd1' })],
      calibrations: [calibration({ pairs: 0, agree_pass: 0, agree_fail: 0, false_pass: 0, false_fail: 0 })],
    });
    expect(report.definitions[0].calibration).toBeNull();
  });
});
