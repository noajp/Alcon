import { describe, expect, it } from 'vitest';
import {
  collectDecisionReviews,
  decodeReviewBody,
  encodeReviewBody,
  REVIEW_OUTCOMES,
  reviewOutcomeLabel,
  suggestedStatusAfter,
  type ReviewInput,
} from '@/alcon/element/actions/campaignReviewModel';

// The same tabletop the decision rules were written against, carried one step
// further. The commander chose sealift over airlift and set D+5 to re-check the
// ETA. D+5 arrives, the ETA has slipped, and the choice is thrown out in favour
// of diverting military reserve stock. That reversal is the thing this module
// has to keep: the decision row can only say `done`, and `done` is also what a
// decision that ran to plan says.

function lineage(over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    id: 'l1',
    intentId: 'd1',
    occurredAt: '2026-09-06T08:00:00.000Z',
    actorName: 'Cdr. Hale',
    actionKind: 'revision',
    body: encodeReviewBody('reversed', 'Sealift ETA slipped past the fuel window'),
    ...over,
  };
}

describe('encoding the outcome into the one free-text column', () => {
  it('round-trips every outcome', () => {
    for (const outcome of REVIEW_OUTCOMES) {
      const body = encodeReviewBody(outcome, 'because the ETA slipped');
      expect(decodeReviewBody(body)).toEqual({
        outcome,
        reason: 'because the ETA slipped',
      });
    }
  });

  it('keeps the outcome readable when the reason talks about outcomes', () => {
    // The whole reason a marker gets its own line. A delimiter inside one line
    // would let the prose below capture the parse.
    const body = encodeReviewBody('reversed', 'upheld at D+3, but review:upheld no longer holds');
    expect(decodeReviewBody(body)).toEqual({
      outcome: 'reversed',
      reason: 'upheld at D+3, but review:upheld no longer holds',
    });
  });

  it('keeps a reason that runs to several lines', () => {
    const body = encodeReviewBody('amended', 'ETA now D+9.\nRe-check when the port reopens.');
    expect(decodeReviewBody(body)).toEqual({
      outcome: 'amended',
      reason: 'ETA now D+9.\nRe-check when the port reopens.',
    });
  });

  it('holds an outcome with no reason attached', () => {
    expect(decodeReviewBody(encodeReviewBody('upheld', '   '))).toEqual({
      outcome: 'upheld',
      reason: '',
    });
  });
});

describe('bodies this surface did not write', () => {
  it('reads prose as prose rather than assigning it an outcome', () => {
    // `revision` entries also arrive from the Edge Function summariser. Calling
    // one of those "Upheld" would be inventing the finding.
    expect(decodeReviewBody('Fuel plan revisited during the evening sync.')).toEqual({
      outcome: null,
      reason: 'Fuel plan revisited during the evening sync.',
    });
  });

  it('strips a marker it does not recognise instead of printing it as prose', () => {
    expect(decodeReviewBody('review:retired\nThe objective was withdrawn.')).toEqual({
      outcome: null,
      reason: 'The objective was withdrawn.',
    });
  });
});

describe('collecting the reviews under their decisions', () => {
  it('takes only revision entries', () => {
    const rows = [
      lineage({ id: 'l1' }),
      lineage({ id: 'l2', actionKind: 'audit' }),
      lineage({ id: 'l3', actionKind: 'escalation' }),
    ];
    expect(collectDecisionReviews(rows).get('d1')?.map((r) => r.id)).toEqual(['l1']);
  });

  it('groups by decision and leaves an unreviewed decision absent', () => {
    const byDecision = collectDecisionReviews([
      lineage({ id: 'l1', intentId: 'd1' }),
      lineage({ id: 'l2', intentId: 'd2' }),
    ]);
    expect(byDecision.get('d1')).toHaveLength(1);
    expect(byDecision.get('d2')).toHaveLength(1);
    expect(byDecision.get('d3')).toBeUndefined();
  });

  it('orders newest first, so the standing finding reads first', () => {
    const rows = [
      lineage({ id: 'l1', occurredAt: '2026-09-06T08:00:00.000Z' }),
      lineage({ id: 'l2', occurredAt: '2026-09-20T08:00:00.000Z' }),
      lineage({ id: 'l3', occurredAt: '2026-09-11T08:00:00.000Z' }),
    ];
    expect(collectDecisionReviews(rows).get('d1')?.map((r) => r.id)).toEqual(['l2', 'l3', 'l1']);
  });

  it('breaks a tie on id rather than on argument order', () => {
    const at = '2026-09-06T08:00:00.000Z';
    const forward = collectDecisionReviews([
      lineage({ id: 'lb', occurredAt: at }),
      lineage({ id: 'la', occurredAt: at }),
    ]);
    const reversed = collectDecisionReviews([
      lineage({ id: 'la', occurredAt: at }),
      lineage({ id: 'lb', occurredAt: at }),
    ]);
    expect(forward.get('d1')?.map((r) => r.id)).toEqual(['la', 'lb']);
    expect(reversed.get('d1')?.map((r) => r.id)).toEqual(['la', 'lb']);
  });

  it('shows a just-written review once, not twice', () => {
    // The caller holds the fetched rows and the row the insert handed back at
    // the same time. Overlapping, they would read as two separate reviews.
    const written = lineage({ id: 'l1' });
    expect(collectDecisionReviews([written, { ...written }]).get('d1')).toHaveLength(1);
  });

  it('carries the reviewer and the decoded finding through', () => {
    const [entry] = collectDecisionReviews([lineage()]).get('d1') ?? [];
    expect(entry).toMatchObject({
      actorName: 'Cdr. Hale',
      outcome: 'reversed',
      reason: 'Sealift ETA slipped past the fuel window',
    });
  });
});

describe('what a review implies about the status', () => {
  it('marks a reversed decision off track, not closed', () => {
    // `done` reads as "Closed" — the same face a decision wears when it simply
    // ran out. The reversal is exactly the distinction being kept.
    expect(suggestedStatusAfter('reversed')).toBe('off_track');
  });

  it('leaves a decision that survived its review where it stands', () => {
    expect(suggestedStatusAfter('upheld')).toBeNull();
    expect(suggestedStatusAfter('amended')).toBeNull();
  });
});

describe('outcome labels', () => {
  it('names all three, and says what amended actually means', () => {
    expect(reviewOutcomeLabel('reversed')).toBe('Reversed');
    expect(reviewOutcomeLabel('upheld')).toBe('Upheld');
    expect(reviewOutcomeLabel('amended')).toBe('Conditions updated');
  });
});
