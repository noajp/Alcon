import { describe, expect, it } from 'vitest';
import { constraintEffectOf, constraintKpiOf, draftBaselineOf } from '@/AIP/harness/constraintModel';
import type { ConstraintDraft, PlanningConstraint } from '@/types/database';

// The review surfaces' shaping (B6): a draft's baseline claim read
// back from its cluster record, the loop's KPI counts, and an active
// constraint's scoreboard values. Pure shaping — the hooks read the
// rows, this decides what is worth a person's eye.

const draft = (over: Partial<ConstraintDraft> = {}): ConstraintDraft => ({
  id: 'cd1', activity_space_id: 's1', scope: 'definition',
  target_definition_id: 'd1', target_strategy_id: null,
  constraint_text: '出典は URL と取得時刻を併記すること',
  derived_from: 'verifier_gap', signature: 'claim:missing-source',
  evidence_outcome_ids: ['o1', 'o2', 'o3'],
  cluster: { outcomes: 3, withSignature: 3, windowOutcomes: 9, baselineRate: 0.3333, signalled: 0, samples: [] },
  calibration_candidate_id: null, structure_hash: 'h', binding_hash: 'b', target_version: 'v',
  status: 'awaiting_review', offered_at: null, decided_by: null, decided_at: null,
  activated_constraint_id: null, expires_at: null,
  created_at: '2026-11-08T00:00:00.000Z', updated_at: '2026-11-08T00:00:00.000Z',
  ...over,
});

const constraint = (over: Partial<PlanningConstraint> = {}): PlanningConstraint => ({
  id: 'c1', activity_space_id: 's1', scope: 'definition',
  target_definition_id: 'd1', target_strategy_id: null,
  constraint_text: '出典は URL と取得時刻を併記すること',
  draft_id: 'cd1', signature: 'claim:missing-source', derived_from: 'verifier_gap',
  baseline_rate: 0.3333, baseline_outcomes: 9, baseline_with: 3,
  effect_status: 'measuring', effect: {}, status: 'active',
  activated_by: 'u1', activated_at: '2026-11-08T00:00:00.000Z',
  retired_by: null, retired_at: null, retire_reason: null,
  created_at: '2026-11-08T00:00:00.000Z', updated_at: '2026-11-08T00:00:00.000Z',
  ...over,
});

describe('draftBaselineOf', () => {
  it('reads the claim back: 3 of 9 runs, 33%', () => {
    expect(draftBaselineOf(draft())).toEqual({ withSignature: 3, windowOutcomes: 9, ratePercent: 33 });
  });

  it('a record without numbers shapes to nothing — nothing is invented', () => {
    expect(draftBaselineOf(draft({ cluster: {} }))).toBeNull();
  });
});

describe('constraintKpiOf', () => {
  it('counts the loop: proposed, active, established, ineffective', () => {
    const kpi = constraintKpiOf(
      [draft(), draft({ id: 'cd2' })],
      [
        constraint(),
        constraint({ id: 'c2', effect_status: 'established' }),
        constraint({ id: 'c3', effect_status: 'ineffective' }),
        constraint({ id: 'c4', status: 'retired', effect_status: 'established' }),
      ],
    );
    expect(kpi).toEqual({ proposed: 2, active: 3, established: 2, ineffective: 1 });
  });
});

describe('constraintEffectOf', () => {
  it('reads the evaluator’s latest numbers over the baseline', () => {
    const fx = constraintEffectOf(constraint({
      effect_status: 'ineffective',
      effect: { under: 6, withSignature: 3, rate: 0.5, baselineRate: 0.3333 },
    }));
    expect(fx).toEqual({ status: 'ineffective', under: 6, withSignature: 3, baselinePercent: 33 });
  });

  it('an unmeasured constraint reads as zeroes, not as a verdict', () => {
    expect(constraintEffectOf(constraint())).toEqual({ status: 'measuring', under: 0, withSignature: 0, baselinePercent: 33 });
  });
});
