// =============================================================
// Campaign decisions — the record of what was chosen, computed.
//
// A decision is not a status update. It has three parts and loses its worth if
// any one of them is dropped: what was chosen, what was given up to choose it,
// and the condition under which it gets reversed. The first two are text the
// author writes; the third is a date, and a date nobody looks at again is the
// same as no date at all. So the ordering below exists to raise the decisions
// whose revisit day has arrived — a commitment running past its own review is
// the only thing on this surface that needs somebody today.
//
// Pure on purpose: no React, no Supabase, no clock of its own. `now` is an
// argument so a test does not have to wait until Tuesday to see a horizon pass.
// =============================================================

/** Mirrors the `intents.status` check constraint. */
export type DecisionStatus = 'on_track' | 'at_risk' | 'off_track' | 'done';

export const DECISION_STATUSES: DecisionStatus[] = [
  'on_track',
  'at_risk',
  'off_track',
  'done',
];

const STATUS_LABELS: Record<DecisionStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
  done: 'Closed',
};

/** One `intents` row, narrowed to the columns a decision record is made of. */
export interface DecisionInput {
  id: string;
  title: string;
  /** What was given up to make this choice. The reason the record exists. */
  abandoned: string | null;
  /** `yyyy-MM-dd` — the day this choice gets looked at again. */
  horizon: string | null;
  status: string | null;
  decidedBy: string | null;
  /** ISO timestamp. */
  decidedAt: string | null;
  orderIndex: number;
  /**
   * When this decision was last looked at again — the newest `revision` entry
   * in its lineage. ISO timestamp, or null when nobody has reviewed it yet.
   */
  lastReviewedAt?: string | null;
}

/**
 * Where the revisit day sits relative to today.
 *
 * `unset` is kept apart from `scheduled` rather than folded into "nothing to
 * do". A decision with no review day is not a calm decision — it is one nobody
 * agreed to check, which is a different problem and gets said out loud.
 *
 * `reviewed` is the day having come *and been answered*. Without it a decision
 * that was reviewed on time stays in the owed band forever, sorted above the
 * ones still waiting and counted beside them — the list telling you to do
 * again the thing you already did.
 */
export type ReviewState = 'unset' | 'overdue' | 'today' | 'scheduled' | 'reviewed';

export interface Decision extends Omit<DecisionInput, 'status'> {
  status: DecisionStatus;
  review: ReviewState;
  /** Whole calendar days from today to the horizon; negative once past. */
  daysToReview: number | null;
}

export function decisionStatusLabel(status: DecisionStatus): string {
  return STATUS_LABELS[status];
}

/** Unknown and missing both mean the column default, which is `on_track`. */
export function normalizeDecisionStatus(status: string | null | undefined): DecisionStatus {
  return DECISION_STATUSES.includes(status as DecisionStatus)
    ? (status as DecisionStatus)
    : 'on_track';
}

/**
 * Calendar days between two days, counted on the calendar and not on the clock.
 *
 * `horizon` is a date column — a day, not an instant — so the comparison is
 * made between day numbers. Subtracting timestamps instead would report a
 * horizon set for tomorrow as "0 days away" all evening, and a horizon parsed
 * as `new Date('2026-09-05')` lands on UTC midnight, which is the 4th for every
 * user west of Greenwich.
 */
function daysBetween(fromDay: string, toDay: string): number | null {
  const from = dayNumber(fromDay);
  const to = dayNumber(toDay);
  if (from === null || to === null) return null;
  return to - from;
}

function dayNumber(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

/**
 * Whether a review landed on or after the day it was owed.
 *
 * Compared on the calendar, in the reader's timezone, because `horizon` is a
 * day and `lastReviewedAt` is an instant. A review recorded *before* the
 * horizon does not answer it — reviewing early is allowed, and the day it was
 * set for still comes.
 */
function answeredOnOrAfter(lastReviewedAt: string | null | undefined, horizon: string | null): boolean {
  if (!lastReviewedAt || !horizon) return false;
  const at = new Date(lastReviewedAt);
  if (Number.isNaN(at.getTime())) return false;
  const reviewed = dayNumber(localDay(at));
  const owed = dayNumber(horizon);
  return reviewed !== null && owed !== null && reviewed >= owed;
}

/** Today in the reader's own timezone, as `yyyy-MM-dd`. */
function localDay(now: Date): string {
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

export function toDecision(input: DecisionInput, now: Date): Decision {
  const daysToReview = input.horizon ? daysBetween(localDay(now), input.horizon) : null;
  const due = daysToReview !== null && daysToReview <= 0;
  const review: ReviewState =
    daysToReview === null ? 'unset'
    : !due ? 'scheduled'
    : answeredOnOrAfter(input.lastReviewedAt, input.horizon) ? 'reviewed'
    : daysToReview < 0 ? 'overdue'
    : 'today';
  return {
    ...input,
    status: normalizeDecisionStatus(input.status),
    review,
    daysToReview,
  };
}

/** A decision still in force whose review day has arrived or gone by. */
export function isDueForReview(decision: Decision): boolean {
  return decision.status !== 'done' && (decision.review === 'overdue' || decision.review === 'today');
}

export function countDueForReview(decisions: Decision[]): number {
  return decisions.filter(isDueForReview).length;
}

/**
 * Worst-first, then newest-first.
 *
 * Three bands, in the order a commander needs them: decisions whose review is
 * owed (most overdue at the top, because that is the longest a choice has run
 * unexamined), then the ones still in force newest first, then the closed ones.
 * Closed decisions sink rather than disappear — the record of what was given up
 * outlives the choice, and that is most of why it was written down.
 */
export function orderDecisions(inputs: DecisionInput[], now: Date): Decision[] {
  return inputs
    .map((input) => toDecision(input, now))
    .sort((a, b) => {
      const band = bandOf(a) - bandOf(b);
      if (band !== 0) return band;
      if (bandOf(a) === 0) {
        // Both owe a review: the one that has been owed longest goes first.
        const days = (a.daysToReview ?? 0) - (b.daysToReview ?? 0);
        if (days !== 0) return days;
      }
      const decided = decidedRank(b) - decidedRank(a);
      if (decided !== 0) return decided;
      if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      return a.id.localeCompare(b.id);
    });
}

function bandOf(decision: Decision): number {
  if (isDueForReview(decision)) return 0;
  return decision.status === 'done' ? 2 : 1;
}

/** Undated decisions sort after dated ones rather than jumping to the top. */
function decidedRank(decision: Decision): number {
  if (!decision.decidedAt) return Number.NEGATIVE_INFINITY;
  const t = new Date(decision.decidedAt).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/**
 * The short phrase the review chip carries. Relative on purpose — the absolute
 * day is printed in the row's meta line, and a chip saying `Sep 5` cannot be
 * read as urgent without the reader doing the subtraction themselves.
 */
export function reviewLabel(decision: Decision): string {
  switch (decision.review) {
    case 'unset':
      return 'No review date';
    case 'today':
      return 'Review today';
    case 'overdue':
      return `Review ${Math.abs(decision.daysToReview ?? 0)}d overdue`;
    case 'reviewed':
      return 'Reviewed';
    default:
      return `Review in ${decision.daysToReview}d`;
  }
}
