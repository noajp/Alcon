import { describe, expect, it } from 'vitest';

const gate = await import(new URL('../../supabase/functions/_shared/readingsGate.ts', import.meta.url).pathname);
const { validateProposals, readingsDecision, parseProposedReadings, readingsSummaryLine } = gate;

const BOUND = [
  { id: 'm1', title: '応答時間', strategyId: 's1' },
  { id: 'm2', title: '解決率', strategyId: 's1' },
];

const verdict = (result: 'pass' | 'fail' | 'unchecked') => ({
  v: 1, result, source: result === 'unchecked' ? 'none' : 'verifier', model: 'claude-test', gaps: [], revisions: 0,
  checkedAt: '2026-11-07T01:00:00Z', outcome: 'completed', reason: null,
  evidence: { verifyStepIdx: 3, artifactIds: [] },
});

describe('validateProposals', () => {
  it('keeps bound measures open and marks unknown ones not-bound, for the record', () => {
    const out = validateProposals([
      { measureId: 'm1', value: 42 },
      { measureId: 'mx', value: 7 },
    ], BOUND);
    expect(out).toEqual([
      { measureId: 'm1', value: 42, applied: false, appliedAt: null, appliedBy: null, heldReason: null },
      { measureId: 'mx', value: 7, applied: false, appliedAt: null, appliedBy: null, heldReason: 'not-bound' },
    ]);
  });

  it('collapses duplicates with the last value winning', () => {
    const out = validateProposals([
      { measureId: 'm1', value: 1 },
      { measureId: 'm2', value: 2 },
      { measureId: 'm1', value: 3 },
    ], BOUND);
    expect(out.map((p: { measureId: string; value: number }) => [p.measureId, p.value])).toEqual([['m1', 3], ['m2', 2]]);
  });

  it('rejects values that are not finite numbers — a reading is a measured number or nothing', () => {
    const out = validateProposals([
      { measureId: 'm1', value: Number.NaN },
      { measureId: 'm2', value: Number.POSITIVE_INFINITY },
      { measureId: 'm1', value: '42' },
    ] as never, BOUND);
    expect(out).toEqual([]);
  });

  it('caps the list at ten proposals', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ measureId: `m${i}`, value: i }));
    expect(validateProposals(raw, BOUND)).toHaveLength(10);
  });

  it('returns nothing for no proposals', () => {
    expect(validateProposals(undefined, BOUND)).toEqual([]);
    expect(validateProposals([], BOUND)).toEqual([]);
  });
});

describe('readingsDecision', () => {
  it('applies a checked pass at finish under auto, whatever acceptance state', () => {
    expect(readingsDecision({ verdict: verdict('pass'), delegation: 'auto', elementClosed: false })).toBe('apply');
    expect(readingsDecision({ verdict: verdict('pass'), delegation: 'auto', elementClosed: true })).toBe('apply');
  });

  it('holds a checked pass under manual review until the work is accepted', () => {
    expect(readingsDecision({ verdict: verdict('pass'), delegation: 'manual', elementClosed: false })).toBe('hold');
    expect(readingsDecision({ verdict: verdict('pass'), delegation: 'manual', elementClosed: true })).toBe('apply');
  });

  it('never lands a fail-standing or unchecked run — not even on acceptance', () => {
    for (const v of [verdict('fail'), verdict('unchecked'), null]) {
      expect(readingsDecision({ verdict: v, delegation: 'auto', elementClosed: false })).toBe('reject');
      expect(readingsDecision({ verdict: v, delegation: 'manual', elementClosed: true })).toBe('reject');
    }
  });
});

describe('parseProposedReadings', () => {
  it('round-trips a validated record and refuses a malformed one', () => {
    const out = validateProposals([{ measureId: 'm1', value: 5 }], BOUND);
    expect(parseProposedReadings(out)).toEqual(out);
    expect(parseProposedReadings(null)).toBeNull();
    expect(parseProposedReadings('nope')).toBeNull();
    expect(parseProposedReadings([{ measureId: 'm1', value: '5', applied: false, appliedAt: null, appliedBy: null, heldReason: null }])).toBeNull();
    expect(parseProposedReadings([{ measureId: 'm1', value: 5, applied: false, appliedAt: null, appliedBy: null, heldReason: 'bogus' }])).toBeNull();
  });
});

describe('readingsSummaryLine', () => {
  const p = (over: Record<string, unknown>) => ({
    measureId: 'm1', value: 1, applied: false, appliedAt: null, appliedBy: null, heldReason: null, ...over,
  });
  it('names each class once, in order, skipping the empty ones', () => {
    const line = readingsSummaryLine([
      p({ applied: true, appliedAt: '2026-11-07T01:00:00Z', appliedBy: 'u1' }),
      p({ measureId: 'm2', heldReason: 'awaiting-acceptance' }),
      p({ measureId: 'm3', heldReason: 'not-bound' }),
    ]);
    expect(line).toBe('成功条件の報告: 1 件を記録、1 件はレビュー待ち、1 件は対象外のため不記録');
  });
  it('says a rejected finish’s numbers were refused for the verdict', () => {
    expect(readingsSummaryLine([p({ heldReason: 'verdict-not-pass' })]))
      .toBe('成功条件の報告: 1 件は検証が通らなかったため不記録');
  });
  it('is empty for no proposals', () => {
    expect(readingsSummaryLine([])).toBe('');
  });
});
