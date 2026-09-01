import { describe, expect, it } from 'vitest';
import {
  countDueForReview,
  decisionStatusLabel,
  isDueForReview,
  normalizeDecisionStatus,
  orderDecisions,
  reviewLabel,
  toDecision,
  type DecisionInput,
} from '@/alcon/element/actions/campaignDecisionModel';

// The scenario these rules were written against: a relief operation hits a fuel
// crisis, the commander picks sealift over airlift, and the choice is only
// worth recording if all three of its parts survive — what was taken, what was
// given up (airlift flexibility), and the condition that reverses it (re-check
// the sealift ETA at D+5). The third part is the one that decays, so most of
// what is asserted below is about the day arriving and the row saying so.

const AT_D0 = new Date(2026, 8, 1, 9, 0); // 2026-09-01, local

function decision(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    id: 'd1',
    title: 'Move the bulk lift to sealift',
    abandoned: 'Airlift slot flexibility',
    horizon: '2026-09-06',
    status: 'on_track',
    decidedBy: 'Cdr. Hale',
    decidedAt: '2026-09-01T00:30:00.000Z',
    orderIndex: 1,
    ...over,
  };
}

describe('normalizeDecisionStatus', () => {
  it('keeps the four the column allows', () => {
    for (const s of ['on_track', 'at_risk', 'off_track', 'done']) {
      expect(normalizeDecisionStatus(s)).toBe(s);
    }
  });

  it('falls back to the column default rather than inventing a status', () => {
    expect(normalizeDecisionStatus(null)).toBe('on_track');
    expect(normalizeDecisionStatus(undefined)).toBe('on_track');
    expect(normalizeDecisionStatus('in_progress')).toBe('on_track');
  });

  it('labels a closed decision as closed, not done', () => {
    // "Done" reads as an Element that finished. A decision does not finish; it
    // stops being in force.
    expect(decisionStatusLabel('done')).toBe('Closed');
    expect(decisionStatusLabel('off_track')).toBe('Off track');
  });
});

describe('review state — the day the choice gets looked at again', () => {
  it('counts calendar days, not elapsed hours', () => {
    // 09-02 is tomorrow at 09:00 and it is still tomorrow at 23:59. Subtracting
    // timestamps would call it "0 days away" for most of the day.
    const late = new Date(2026, 8, 1, 23, 59);
    expect(toDecision(decision({ horizon: '2026-09-02' }), late).daysToReview).toBe(1);
    expect(toDecision(decision({ horizon: '2026-09-02' }), late).review).toBe('scheduled');
  });

  it('does not shift the day for readers west of Greenwich', () => {
    // `new Date('2026-09-01')` is UTC midnight, which is 2026-08-31 in the
    // Americas. Parsed from its parts, today's horizon is today everywhere.
    const d = toDecision(decision({ horizon: '2026-09-01' }), AT_D0);
    expect(d.review).toBe('today');
    expect(d.daysToReview).toBe(0);
  });

  it('marks a passed horizon overdue and says how long by', () => {
    const d = toDecision(decision({ horizon: '2026-08-29' }), AT_D0);
    expect(d.review).toBe('overdue');
    expect(d.daysToReview).toBe(-3);
    expect(reviewLabel(d)).toBe('Review 3d overdue');
  });

  it('keeps "no review date" apart from "review is in the future"', () => {
    // A decision nobody agreed to re-check is not a calm decision; it is a
    // different problem, and folding it into "scheduled" hides it.
    const none = toDecision(decision({ horizon: null }), AT_D0);
    expect(none.review).toBe('unset');
    expect(none.daysToReview).toBeNull();
    expect(reviewLabel(none)).toBe('No review date');
    expect(reviewLabel(toDecision(decision(), AT_D0))).toBe('Review in 5d');
    expect(reviewLabel(toDecision(decision({ horizon: '2026-09-01' }), AT_D0))).toBe(
      'Review today',
    );
  });

  it('treats an unparseable horizon as no horizon instead of throwing', () => {
    const d = toDecision(decision({ horizon: 'someday' }), AT_D0);
    expect(d.review).toBe('unset');
    expect(d.daysToReview).toBeNull();
  });
});

describe('isDueForReview / countDueForReview', () => {
  it('owes a review on the day and every day after', () => {
    expect(isDueForReview(toDecision(decision({ horizon: '2026-09-01' }), AT_D0))).toBe(true);
    expect(isDueForReview(toDecision(decision({ horizon: '2026-08-20' }), AT_D0))).toBe(true);
    expect(isDueForReview(toDecision(decision({ horizon: '2026-09-06' }), AT_D0))).toBe(false);
    expect(isDueForReview(toDecision(decision({ horizon: null }), AT_D0))).toBe(false);
  });

  it('stops owing a review once the decision is closed', () => {
    const closed = toDecision(decision({ horizon: '2026-08-20', status: 'done' }), AT_D0);
    expect(closed.review).toBe('overdue');
    expect(isDueForReview(closed)).toBe(false);
  });

  it('counts only the ones that need somebody today', () => {
    const rows = orderDecisions(
      [
        decision({ id: 'a', horizon: '2026-08-20' }),
        decision({ id: 'b', horizon: '2026-09-01' }),
        decision({ id: 'c', horizon: '2026-12-01' }),
        decision({ id: 'd', horizon: '2026-08-20', status: 'done' }),
        decision({ id: 'e', horizon: null }),
      ],
      AT_D0,
    );
    expect(countDueForReview(rows)).toBe(2);
  });
});

describe('orderDecisions', () => {
  it('puts the reviews that are owed first, longest-owed at the top', () => {
    const rows = orderDecisions(
      [
        decision({ id: 'recent', horizon: '2026-12-01', decidedAt: '2026-09-01T08:00:00Z' }),
        decision({ id: 'today', horizon: '2026-09-01' }),
        decision({ id: 'weeks', horizon: '2026-08-11' }),
        decision({ id: 'days', horizon: '2026-08-29' }),
      ],
      AT_D0,
    );
    expect(rows.map((r) => r.id)).toEqual(['weeks', 'days', 'today', 'recent']);
  });

  it('orders the decisions still in force newest first', () => {
    const rows = orderDecisions(
      [
        decision({ id: 'old', horizon: null, decidedAt: '2026-08-01T00:00:00Z' }),
        decision({ id: 'new', horizon: null, decidedAt: '2026-08-30T00:00:00Z' }),
        decision({ id: 'mid', horizon: null, decidedAt: '2026-08-15T00:00:00Z' }),
      ],
      AT_D0,
    );
    expect(rows.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sinks an undated decision below the dated ones instead of floating it', () => {
    const rows = orderDecisions(
      [
        decision({ id: 'undated', horizon: null, decidedAt: null }),
        decision({ id: 'dated', horizon: null, decidedAt: '2026-08-01T00:00:00Z' }),
      ],
      AT_D0,
    );
    expect(rows.map((r) => r.id)).toEqual(['dated', 'undated']);
  });

  it('sinks closed decisions to the bottom without dropping them', () => {
    // The record of what was given up outlives the choice — that is most of
    // why anyone wrote it down.
    const rows = orderDecisions(
      [
        decision({ id: 'closed', status: 'done', horizon: null, decidedAt: '2026-08-31T00:00:00Z' }),
        decision({ id: 'live', horizon: null, decidedAt: '2026-08-01T00:00:00Z' }),
      ],
      AT_D0,
    );
    expect(rows.map((r) => r.id)).toEqual(['live', 'closed']);
    expect(rows).toHaveLength(2);
  });

  it('is stable when two decisions carry the same timestamp', () => {
    const same = { horizon: null, decidedAt: '2026-08-01T00:00:00Z' };
    const rows = orderDecisions(
      [decision({ id: 'b', orderIndex: 2, ...same }), decision({ id: 'a', orderIndex: 1, ...same })],
      AT_D0,
    );
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('carries what was given up through untouched', () => {
    const [only] = orderDecisions([decision()], AT_D0);
    expect(only.abandoned).toBe('Airlift slot flexibility');
    expect(only.decidedBy).toBe('Cdr. Hale');
  });

  it('returns an empty list for an empty Campaign rather than a placeholder row', () => {
    expect(orderDecisions([], AT_D0)).toEqual([]);
  });
});

describe('a review that has already happened', () => {
  // The exercise that produced this rule: the commander's D+5 condition came
  // due, the review was recorded, and the row went on claiming the review was
  // owed — sorted above the decisions still waiting and counted beside them.
  const AT_D10 = new Date(2026, 8, 10, 9, 0); // 2026-09-10, local

  it('answers the horizon when it lands on the day itself', () => {
    const [d] = orderDecisions(
      [decision({ horizon: '2026-09-06', lastReviewedAt: '2026-09-06T14:00:00.000Z' })],
      AT_D10,
    );
    expect(d.review).toBe('reviewed');
    expect(isDueForReview(d)).toBe(false);
    expect(reviewLabel(d)).toBe('Reviewed');
  });

  it('answers it when the review came later', () => {
    const d = toDecision(decision({ lastReviewedAt: '2026-09-09T02:00:00.000Z' }), AT_D10);
    expect(d.review).toBe('reviewed');
  });

  it('does not answer it when the review came first — reviewing early is not reviewing', () => {
    // Looked at on the 3rd; the 6th still comes.
    const d = toDecision(decision({ lastReviewedAt: '2026-09-03T02:00:00.000Z' }), AT_D10);
    expect(d.review).toBe('overdue');
    expect(isDueForReview(d)).toBe(true);
  });

  it('leaves a horizon still ahead alone, reviewed or not', () => {
    const early = toDecision(decision({ lastReviewedAt: '2026-09-01T02:00:00.000Z' }), AT_D0);
    expect(early.review).toBe('scheduled');
    expect(reviewLabel(early)).toBe('Review in 5d');
  });

  it('still owes a review when none has been recorded', () => {
    expect(toDecision(decision(), AT_D10).review).toBe('overdue');
    expect(toDecision(decision({ lastReviewedAt: null }), AT_D10).review).toBe('overdue');
  });

  it('ignores an unparseable timestamp rather than treating it as an answer', () => {
    const d = toDecision(decision({ lastReviewedAt: 'not a date' }), AT_D10);
    expect(d.review).toBe('overdue');
  });

  it('drops a reviewed decision out of the owed band and out of the count', () => {
    const rows = orderDecisions(
      [
        decision({ id: 'answered', horizon: '2026-09-06', lastReviewedAt: '2026-09-07T00:00:00.000Z' }),
        decision({ id: 'waiting', horizon: '2026-09-08', lastReviewedAt: null }),
      ],
      AT_D10,
    );
    expect(rows.map((r) => r.id)).toEqual(['waiting', 'answered']);
    expect(countDueForReview(rows)).toBe(1);
  });
});
