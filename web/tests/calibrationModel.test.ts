import { describe, expect, it } from 'vitest';

// The calibration drill-down's shaping (B5,
// AIP/harness/calibrationModel.ts): the three numbers a person
// judges a definition's verifier by — agreements as one count, the
// two disagreement directions apart — and silence where nothing has
// been measured.
import { calibrationSummaryOf, candidateErrorCount, ratePercent } from '@/AIP/harness/calibrationModel';
import type { VerifierCalibration } from '@/types/database';

const row = (over: Partial<VerifierCalibration> = {}): VerifierCalibration => ({
  id: 'vc1', activity_space_id: 's1', definition_id: 'd1',
  window_start: '2026-10-13T00:00:00.000Z', window_days: 28,
  agree_pass: 0, agree_fail: 0, false_pass: 0, false_fail: 0, pairs: 0,
  updated_at: '2026-11-09T00:00:00.000Z', ...over,
});

describe('calibrationSummaryOf', () => {
  it('folds the two agreements into one count and keeps the directions apart', () => {
    expect(calibrationSummaryOf(row({ agree_pass: 7, agree_fail: 3, false_pass: 4, false_fail: 1, pairs: 15 })))
      .toEqual({ agree: 10, falsePass: 4, falseFail: 1, pairs: 15, windowDays: 28 });
  });

  it('is silent where nothing was measured', () => {
    expect(calibrationSummaryOf(null)).toBeNull();
    expect(calibrationSummaryOf(row({ pairs: 0 }))).toBeNull();
  });
});

describe('candidate numbers as a person reads them', () => {
  it('reads the stored rate back to whole outcomes and whole percent', () => {
    expect(candidateErrorCount({ rate: 0.4167, pairs: 12 })).toBe(5);
    expect(candidateErrorCount({ rate: 0.3, pairs: 10 })).toBe(3);
    expect(ratePercent(0.4167)).toBe(42);
    expect(ratePercent(0.3)).toBe(30);
  });
});
