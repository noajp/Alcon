/** @vitest-environment jsdom */
// The Evaluation tab's render pins: the cold start is one honest empty
// state (not six zeroes), rates are withheld below the model's n>=5
// denominator threshold, the drill-down shows the verdict's own words,
// and "Open in Audit" hands the run id to the caller's Audit route.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { StrategyEvaluationData } from '@/hooks/strategyEvaluationData';
import type { EvaluationOutcomeRow, EvaluationRunRow } from '@/ActivitySpace/strategy/initiative/evaluationModel';
import { parseRunVerdict, parseFailureDetail, parseFinishDetail } from '@/Function/audit/auditModel';

let fixture: StrategyEvaluationData = {
  outcomes: [], runs: [], artifacts: [], calibrations: [], candidates: [], tests: [], definitionNames: {}, truncated: false,
};

vi.mock('@/hooks/strategyEvaluationData', () => ({
  useStrategyEvaluation: () => ({ data: fixture, loading: false, error: null }),
  OUTCOME_CAP: 2_000,
}));

// Recharts needs layout the jsdom box does not have; the trend's spec is
// pinned in evaluationModel.test.ts, so the panel test stubs the chart.
vi.mock('@/ActivitySpace/strategy/initiative/EvaluationTrend', () => ({
  EvaluationTrend: () => <div data-testid="evaluation-trend" />,
}));

const { StrategyEvaluationPanel } = await import('@/ActivitySpace/strategy/initiative/StrategyEvaluationPanel');

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function outcome(over: Partial<EvaluationOutcomeRow> = {}): EvaluationOutcomeRow {
  seq += 1;
  return {
    id: `o${seq}`, run_id: `r${seq}`, element_id: 'e1', definition_id: null,
    outcome: 'completed', verdict_result: 'pass', human_signal: 'none',
    revisions: 0, cost_usd: 2, readings_applied: 0, readings_held: 0,
    finished_at: iso(NOW - DAY), ...over,
  };
}

const OBJECTS = [
  { id: 'obj1', name: 'Alpha', elements: [{ id: 'e1', title: 'First Element', display_id: 'ELE-1' }] },
];

beforeEach(() => {
  seq = 0;
  fixture = {
    outcomes: [], runs: [], artifacts: [], calibrations: [], candidates: [], tests: [], definitionNames: {}, truncated: false,
  };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Strategy Evaluation tab', () => {
  it('cold start: one empty state, no headline zeroes', () => {
    render(<StrategyEvaluationPanel objects={OBJECTS} />);
    expect(screen.getByText('No evaluation records yet')).toBeTruthy();
    expect(screen.queryByText('Verifier pass rate')).toBeNull();
  });

  it('withholds the pass rate below the threshold and shows the counts instead', () => {
    fixture.outcomes = [
      outcome({ verdict_result: 'pass' }), outcome({ verdict_result: 'pass' }),
      outcome({ verdict_result: 'pass' }), outcome({ verdict_result: 'fail' }),
    ];
    render(<StrategyEvaluationPanel objects={OBJECTS} />);
    // 3 of 4 checked: denominator 4 < 5, so no "75%" anywhere.
    expect(screen.queryByText('75%')).toBeNull();
    expect(screen.getByText('Only 4 checked — no rate yet')).toBeTruthy();
    expect(screen.getByText('3 / 4')).toBeTruthy();
  });

  it('shows the rate once the denominator reaches 5, with unchecked named in the sub-caption', () => {
    fixture.outcomes = [
      ...Array.from({ length: 4 }, () => outcome({ verdict_result: 'pass' })),
      outcome({ verdict_result: 'fail' }),
      outcome({ verdict_result: 'unchecked' }),
    ];
    render(<StrategyEvaluationPanel objects={OBJECTS} />);
    expect(screen.getByText('80%')).toBeTruthy();
    expect(screen.getByText('1 finishes were not checked')).toBeTruthy();
  });

  it('drills Object → Element → worst run: verdict gaps, claims, failure class, and Open in Audit', async () => {
    const failed = outcome({ verdict_result: 'fail', human_signal: 'rework' });
    const verdict = parseRunVerdict({
      v: 2, result: 'fail', source: 'verifier', model: 'm', gaps: ['The deck has no numbers'], revisions: 1,
      checkedAt: iso(NOW - DAY), outcome: 'completed', reason: 'revisions-exhausted',
      evidence: { verifyStepIdx: 3, artifactIds: [] },
      claims: { total: 4, sourced: 2, stale: 1 }, claimGaps: [],
    });
    const runRow: EvaluationRunRow = {
      id: failed.run_id, element_id: 'e1', status: 'completed', finished_at: failed.finished_at,
      verdict,
      finishDetail: parseFinishDetail({ claims: [], unconfirmed: ['the price'] }),
      failureDetail: parseFailureDetail({
        class: 'verify_mismatch', compensate: { policy: 'ask', source: 'default' }, escalate: null,
        retries: 1, giveUp: null, at: iso(NOW - DAY),
      }),
    };
    fixture.outcomes = [failed];
    fixture.runs = [runRow];
    const onOpenRun = vi.fn();
    render(<StrategyEvaluationPanel objects={OBJECTS} onOpenRun={onOpenRun} />);

    fireEvent.click(screen.getByText('Alpha'));
    fireEvent.click(screen.getByText(/First Element/));
    // The worst run row is there; expand it.
    const runButton = screen.getByText(/fail · rework/);
    fireEvent.click(runButton);
    expect(await screen.findByText(/The deck has no numbers/)).toBeTruthy();
    expect(screen.getByText(/Claims: 2 of 4 sourced · 1 stale/)).toBeTruthy();
    // Headline top-failure, the Object row and the run drill all name it.
    expect(screen.getAllByText(/verify_mismatch/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/the price/)).toBeTruthy();

    fireEvent.click(screen.getByText('Open in Audit'));
    expect(onOpenRun).toHaveBeenCalledWith(failed.run_id);
  });
});
