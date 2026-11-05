export interface DomainApproach {
  id: string; domain_id: string; strategy_id: string; measure_id: string | null;
  title: string; expected_change: string; hypothesis: string; assumptions: string;
  review_trigger: string; review_date: string | null; revision: number; plan_revision: number;
  created_by: string; created_at: string; updated_at: string;
}
export interface ApproachCondition {
  id: string; approach_id: string; title: string; kind: 'outcome' | 'readiness' | 'learning';
  required: boolean; success_criteria: string; review_date: string | null; created_at: string;
}
export interface ApproachContribution {
  id: string; approach_id: string; condition_id: string; object_id: string;
  role: 'primary' | 'alternative' | 'supporting'; rationale: string; sequence_note: string;
}
export interface ApproachAssessment {
  id: string; approach_id: string; condition_id: string; plan_revision: number;
  result: 'met' | 'not_met' | 'unverified' | 'refuted'; observation: string;
  evidence_source: string; observed_on: string; reasoning: string; author_id: string; created_at: string;
}
export interface ApproachReview {
  id: string; approach_id: string; expected_revision: number; action: 'continue' | 'change' | 'stop';
  reasoning: string; changes: string; next_review_date: string | null;
  snapshot: { approach: DomainApproach; conditions: ApproachCondition[]; contributions: ApproachContribution[]; assessments: ApproachAssessment[] };
  author_id: string; created_at: string;
}
export interface ApproachData {
  approaches: DomainApproach[]; conditions: ApproachCondition[]; contributions: ApproachContribution[];
  assessments: ApproachAssessment[]; reviews: ApproachReview[];
}
const RESULT_LABELS = { met: 'Met', not_met: 'Not met', unverified: 'Unverified', refuted: 'Premise refuted', stale: 'Reassessment needed' } as const;
// Labels are English message keys; translate them at render time with t().
export const KIND_LABELS = { outcome: 'Outcome', readiness: 'Readiness', learning: 'Learning question' } as const;
function latestRecord<T extends { id: string; created_at: string }>(records: readonly T[]): T | undefined {
  return records.reduce<T | undefined>((latest, row) => !latest || row.created_at > latest.created_at || (row.created_at === latest.created_at && row.id > latest.id) ? row : latest, undefined);
}
export function conditionAssessment(condition: ApproachCondition, approach: DomainApproach, assessments: ApproachAssessment[]) {
  const latest = latestRecord(assessments.filter(a => a.condition_id === condition.id));
  return { latest, status: latest ? latest.plan_revision === approach.plan_revision ? latest.result : 'stale' : 'unverified' } as const;
}
function approachReview(approach: DomainApproach, reviews: ApproachReview[]) {
  return latestRecord(reviews.filter(r => r.approach_id === approach.id));
}
function effectiveReviewDate(approach: DomainApproach, reviews: ApproachReview[]) {
  const review = approachReview(approach, reviews);
  return review && review.snapshot.approach.review_date === approach.review_date ? review.next_review_date : approach.review_date;
}
export function approachAttention(approach: DomainApproach, data: ApproachData, today: string) {
  const review = approachReview(approach, data.reviews);
  if (review?.action === 'stop') return [];
  const reasons: string[] = [];
  const reviewDate = effectiveReviewDate(approach, data.reviews);
  if (reviewDate && reviewDate <= today) reasons.push('Review due');
  const conditions = data.conditions.filter(c => c.approach_id === approach.id);
  if (!conditions.length) reasons.push('Define success conditions');
  for (const c of conditions) {
    const { status } = conditionAssessment(c, approach, data.assessments);
    if (status === 'refuted') reasons.push(`Premise refuted: ${c.title}`);
    else if (c.required && status !== 'met') reasons.push(`${RESULT_LABELS[status]}: ${c.title}`);
    else if (c.review_date && c.review_date <= today && (!conditionAssessment(c, approach, data.assessments).latest || conditionAssessment(c, approach, data.assessments).latest!.observed_on < c.review_date)) reasons.push(`Condition review due: ${c.title}`);
  }
  if (review?.action === 'change' && review.snapshot.approach.plan_revision === approach.plan_revision) reasons.push('Apply the agreed change to the approach');
  return reasons;
}
export function sharedApproachObjects(data: ApproachData) {
  const active = new Set(data.approaches.filter(a => approachReview(a, data.reviews)?.action !== 'stop').map(a => a.id));
  const groups = new Map<string, ApproachContribution[]>();
  for (const c of data.contributions) {
    if (!active.has(c.approach_id)) continue;
    groups.set(c.object_id, [...(groups.get(c.object_id) ?? []), c]);
  }
  return [...groups].filter(([, rows]) => new Set(rows.map(r => r.approach_id)).size > 1);
}
