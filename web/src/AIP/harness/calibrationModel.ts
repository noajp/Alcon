import type { DefinitionRevisionCandidate, VerifierCalibration } from '@/types/database';

// Verifier calibration (B5), shaped for the harness drill-down: the
// definition's review surface shows its calibration as the three
// numbers the design calls the decision minimum — how often the
// verifier and the person agreed, how often it passed work the
// person sent back (false pass), how often it failed work the person
// accepted anyway (false fail) — over the pairs both sides spoke on.
// Pure: the hook reads the rows, this file decides what of them is
// worth a person's eye. Below the data there is nothing to shape:
// calibration speaks only where pairs exist, so an unmeasured
// definition shows no section at all.

/** The drill-down's numbers: agreements as one count, the two
 *  disagreement directions apart, over the window's pairs. */
export interface CalibrationSummary {
  agree: number;
  falsePass: number;
  falseFail: number;
  pairs: number;
  windowDays: number;
}

/** The summary for the definition's latest calibration row, or null
 *  when nothing has been measured (no row, or a row with no pairs —
 *  the evaluator writes rows only for definitions with pairs, so a
 *  null here means calibration has had nothing to grade yet). */
export function calibrationSummaryOf(row: VerifierCalibration | null): CalibrationSummary | null {
  if (!row || row.pairs <= 0) return null;
  return {
    agree: row.agree_pass + row.agree_fail,
    falsePass: row.false_pass,
    falseFail: row.false_fail,
    pairs: row.pairs,
    windowDays: row.window_days,
  };
}

/** The candidate's error count, as its rate over its pairs reads
 *  back to whole outcomes (the rate is the stored claim; the count
 *  is what a person pictures). */
export function candidateErrorCount(candidate: Pick<DefinitionRevisionCandidate, 'rate' | 'pairs'>): number {
  return Math.round(candidate.rate * candidate.pairs);
}

/** A stored rate (0–1) as the whole percent the surfaces show. */
export function ratePercent(rate: number): number {
  return Math.round(rate * 100);
}
