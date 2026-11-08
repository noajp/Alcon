import type { ConstraintDraft, PlanningConstraint } from '@/types/database';

// Learned constraints (B6), shaped for the review surfaces: the queue
// shows a draft's claim — the failure it answers, how often that
// failure showed in the target's recent runs (the baseline it claims
// it will move), and how much evidence stands behind it — and an
// active constraint shows its scoreboard: the same rate, over the
// runs that ran under it. Pure: the hooks read rows, this file
// decides what of them is worth a person's eye. The decision minimum
// and nothing else — the design's surface discipline.

/** A draft's baseline claim, read back from its cluster record:
 *  the signature's count over the target's window outcomes, and the
 *  rate that makes. Null when the record carries no numbers (a
 *  draft written before they were stamped — nothing is invented). */
export function draftBaselineOf(draft: Pick<ConstraintDraft, 'cluster'>): { withSignature: number; windowOutcomes: number; ratePercent: number } | null {
  const withSignature = draft.cluster?.withSignature;
  const windowOutcomes = draft.cluster?.windowOutcomes;
  const rate = draft.cluster?.baselineRate;
  if (typeof withSignature !== 'number' || typeof windowOutcomes !== 'number' || typeof rate !== 'number') return null;
  return { withSignature, windowOutcomes, ratePercent: Math.round(rate * 100) };
}

/** The loop's own KPI: how many constraints were proposed, how many
 *  are live, and how the live and retired ones scored — established
 *  (the failure stayed down) or ineffective (flagged, never removed
 *  by the measurement). Counted from the rows the queue loads. */
export interface ConstraintKpi {
  proposed: number;
  active: number;
  established: number;
  ineffective: number;
}

export function constraintKpiOf(drafts: readonly ConstraintDraft[], constraints: readonly PlanningConstraint[]): ConstraintKpi {
  return {
    proposed: drafts.length,
    active: constraints.filter((c) => c.status === 'active').length,
    established: constraints.filter((c) => c.effect_status === 'established').length,
    ineffective: constraints.filter((c) => c.effect_status === 'ineffective').length,
  };
}

/** An active constraint's scoreboard line values: its baseline as a
 *  percent, and the evaluator's latest reading (runs under it, how
 *  many still carried the failure). */
export function constraintEffectOf(c: PlanningConstraint): {
  status: PlanningConstraint['effect_status'];
  under: number;
  withSignature: number;
  baselinePercent: number;
} {
  return {
    status: c.effect_status,
    under: typeof c.effect?.under === 'number' ? c.effect.under : 0,
    withSignature: typeof c.effect?.withSignature === 'number' ? c.effect.withSignature : 0,
    baselinePercent: Math.round(c.baseline_rate * 100),
  };
}
