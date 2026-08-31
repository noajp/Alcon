// =============================================================
// Decision reviews — what came of looking again.
//
// A decision carries the day it gets re-examined. When that day arrives
// somebody looks, and the looking has an outcome: the choice was thrown out,
// it was left standing, or its terms moved. Without a place to put that, the
// only thing the record can absorb is the decision closing — and a closed
// decision reads as one that ran its course, which is the opposite of one that
// was overturned. Three different histories collapse into the same row.
//
// So a review is an append, not an edit. It lands in `intent_lineage` as a
// `revision` entry and the decision keeps every one it has ever had. The
// status may follow along, but the status is a summary; the entries are the
// record, and nothing here removes one.
//
// Pure on purpose: no React, no Supabase, no clock of its own — the same
// contract `campaignDecisionModel` keeps, for the same reason.
// =============================================================

import type { DecisionStatus } from '@/alcon/element/actions/campaignDecisionModel';

/** The three ways looking again can land. */
export type ReviewOutcome = 'reversed' | 'upheld' | 'amended';

export const REVIEW_OUTCOMES: ReviewOutcome[] = ['reversed', 'upheld', 'amended'];

const OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  reversed: 'Reversed',
  upheld: 'Upheld',
  amended: 'Conditions updated',
};

export function reviewOutcomeLabel(outcome: ReviewOutcome): string {
  return OUTCOME_LABELS[outcome];
}

/**
 * `intent_lineage.body` is one free-text column, and the outcome has to survive
 * in it without a schema change.
 *
 * It goes on a line of its own at the top, so the reason underneath can say
 * anything at all — including the word "upheld" — without the reader or the
 * parser having to guess where the marker ends. A delimiter inside a line
 * cannot promise that: the first plausible separator in the prose would win.
 */
const MARKER = 'review:';

export function encodeReviewBody(outcome: ReviewOutcome, reason: string): string {
  const trimmed = reason.trim();
  return trimmed ? `${MARKER}${outcome}\n${trimmed}` : `${MARKER}${outcome}`;
}

/**
 * The inverse, and it has to tolerate bodies this app did not write — the
 * lineage table also takes entries summarised by an Edge Function, and
 * `revision` is not a kind only this surface uses. An unmarked body is not
 * corrupt; it is prose with no outcome attached, and it says so by decoding to
 * a null outcome rather than being assigned one.
 */
export function decodeReviewBody(body: string): { outcome: ReviewOutcome | null; reason: string } {
  const brk = body.indexOf('\n');
  const head = (brk === -1 ? body : body.slice(0, brk)).trim();
  if (!head.startsWith(MARKER)) return { outcome: null, reason: body.trim() };
  const value = head.slice(MARKER.length);
  return {
    // An unrecognised marker still gets its line stripped. A value this build
    // does not know is a value a later one added, and printing `review:retired`
    // as though it were the author's sentence is worse than printing nothing.
    outcome: REVIEW_OUTCOMES.includes(value as ReviewOutcome) ? (value as ReviewOutcome) : null,
    reason: brk === -1 ? '' : body.slice(brk + 1).trim(),
  };
}

/** One `intent_lineage` row, narrowed to what a review is made of. */
export interface ReviewInput {
  id: string;
  intentId: string;
  /** ISO timestamp. */
  occurredAt: string;
  actorName: string;
  actionKind: string;
  body: string;
}

export interface DecisionReview {
  id: string;
  occurredAt: string;
  actorName: string;
  outcome: ReviewOutcome | null;
  reason: string;
}

/**
 * Group the lineage under the decisions it belongs to, newest first.
 *
 * Deduplicated by id because the caller holds two sources at once: the rows the
 * last fetch returned, and the row a write just handed back. Until the refetch
 * lands they overlap, and a review that appears twice reads as a decision
 * reviewed twice.
 */
export function collectDecisionReviews(rows: ReviewInput[]): Map<string, DecisionReview[]> {
  const seen = new Set<string>();
  const byDecision = new Map<string, DecisionReview[]>();
  for (const row of rows) {
    if (row.actionKind !== 'revision' || seen.has(row.id)) continue;
    seen.add(row.id);
    const { outcome, reason } = decodeReviewBody(row.body);
    const list = byDecision.get(row.intentId) ?? [];
    list.push({
      id: row.id,
      occurredAt: row.occurredAt,
      actorName: row.actorName,
      outcome,
      reason,
    });
    byDecision.set(row.intentId, list);
  }
  for (const list of byDecision.values()) list.sort(compareReviews);
  return byDecision;
}

/** Newest first; id breaks the tie so two reviews filed in the same second
 *  do not swap places between renders. */
function compareReviews(a: DecisionReview, b: DecisionReview): number {
  const at = Date.parse(a.occurredAt);
  const bt = Date.parse(b.occurredAt);
  const av = Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at;
  const bv = Number.isNaN(bt) ? Number.NEGATIVE_INFINITY : bt;
  if (av !== bv) return bv - av;
  return a.id.localeCompare(b.id);
}

/**
 * The status a review implies, or null when it implies none.
 *
 * Only a reversal changes what the row claims: the choice is no longer in
 * force and the assumption under it failed, which is what `off_track` says.
 * `done` would file it beside a decision that simply ran out, and lose the
 * distinction the review was recorded to keep.
 *
 * Upholding and amending leave the status where it is on purpose — a decision
 * that survived its review is still the decision it was, and moving the status
 * to mark that the *review* happened would be the status answering a question
 * it was not asked.
 */
export function suggestedStatusAfter(outcome: ReviewOutcome): DecisionStatus | null {
  return outcome === 'reversed' ? 'off_track' : null;
}
