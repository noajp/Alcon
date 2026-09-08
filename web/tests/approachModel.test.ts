import { describe, expect, it } from 'vitest';
import { approachAttention, conditionAssessment, sharedApproachObjects, type ApproachData, type DomainApproach, type ApproachAssessment, type ApproachCondition, type ApproachReview } from '../src/ActivitySpace/execution/domain/approachModel';
const a: DomainApproach = { id: 'a', domain_id: 'd', strategy_id: 's', measure_id: null, title: 'Demand', expected_change: 'Learn', hypothesis: 'A demonstration yields feedback', assumptions: '', review_trigger: '', review_date: '2026-09-10', revision: 4, plan_revision: 2, created_by: 'u', created_at: '2026-09-01', updated_at: '2026-09-03' };
const c: ApproachCondition = { id: 'c', approach_id: 'a', title: 'Comprehension', kind: 'learning', required: true, success_criteria: 'Visitors explain value', review_date: null, created_at: '2026-09-01' };
const assessment: ApproachAssessment = { id: 'e', approach_id: 'a', condition_id: 'c', plan_revision: 2, result: 'met', observation: 'They explain it', evidence_source: 'Notes', observed_on: '2026-09-02', reasoning: 'They understood', author_id: 'u', created_at: '2026-09-02' };
const data = (patch: Partial<ApproachData> = {}): ApproachData => ({ approaches: [a], conditions: [c], contributions: [], assessments: [assessment], reviews: [], ...patch });
const review = (patch: Partial<ApproachReview> = {}): ApproachReview => ({ id: 'r', approach_id: 'a', expected_revision: 4, action: 'continue', reasoning: 'Continue testing', changes: '', next_review_date: '2026-09-20', snapshot: { approach: a, conditions: [c], contributions: [], assessments: [assessment] }, author_id: 'u', created_at: '2026-09-03', ...patch });
describe('Approach judgment', () => {
  it('never infers success from project completion', () => {
    expect(conditionAssessment(c, a, []).status).toBe('unverified');
    expect(approachAttention(a, data({ assessments: [] }), '2026-09-05')).toEqual(['Unverified: Comprehension']);
  });
  it('invalidates old evidence after plan changes without losing provenance', () => {
    expect(conditionAssessment(c, { ...a, plan_revision: 3 }, [assessment])).toEqual({ status: 'stale', latest: assessment });
  });
  it('uses latest unfavorable judgment over older favorable evidence', () => {
    const latest = { ...assessment, id: 'e2', result: 'refuted' as const, created_at: '2026-09-03' };
    expect(approachAttention(a, data({ assessments: [latest, assessment] }), '2026-09-05')).toEqual(['Premise refuted: Comprehension']);
  });
  it('makes optional conditions nonblocking but always exposes refutation', () => {
    const conditions = [{ ...c, required: false }];
    expect(approachAttention(a, data({ conditions, assessments: [] }), '2026-09-05')).toEqual([]);
    expect(approachAttention(a, data({ conditions, assessments: [{ ...assessment, result: 'refuted' }] }), '2026-09-05')).toHaveLength(1);
  });
  it('retains the next review date after new observations; due day is inclusive', () => {
    const changed = { ...a, revision: 8, updated_at: '2026-09-12' };
    expect(approachAttention(changed, data({ reviews: [review()] }), '2026-09-12')).toEqual([]);
    expect(approachAttention(changed, data({ reviews: [review()] }), '2026-09-20')).toEqual(['Review due']);
  });
  it('stop suppresses flags, a later continue reopens review', () => {
    const stop = review({ action: 'stop' });
    expect(approachAttention(a, data({ reviews: [stop], assessments: [] }), '2026-09-30')).toEqual([]);
    expect(approachAttention(a, data({ reviews: [stop, review({ id: 'r2', created_at: '2026-09-04' })], assessments: [] }), '2026-09-30')).toHaveLength(2);
  });
  it('keeps agreed change actionable until the recorded plan changes', () => {
    const d = data({ reviews: [review({ action: 'change', changes: 'Replace prototype with video' })] });
    expect(approachAttention(a, d, '2026-09-05')).toContain('Apply the agreed change to the approach');
    expect(approachAttention({ ...a, plan_revision: 3 }, d, '2026-09-05')).not.toContain('Apply the agreed change to the approach');
  });
  it('compares Objects across distinct active approaches, not two conditions in one', () => {
    const first = { id: 'l', approach_id: 'a', condition_id: 'c', object_id: 'o', role: 'primary' as const, rationale: 'Test', sequence_note: '' };
    expect(sharedApproachObjects(data({ contributions: [first, { ...first, id: 'l2', condition_id: 'c2' }] }))).toEqual([]);
    const d = data({ approaches: [a, { ...a, id: 'b' }], contributions: [first, { ...first, id: 'l3', approach_id: 'b', role: 'alternative' }] });
    expect(sharedApproachObjects(d)[0][0]).toBe('o');
    expect(sharedApproachObjects({ ...d, reviews: [review({ action: 'stop' })] })).toEqual([]);
  });
});
