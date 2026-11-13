// =============================================================
// The return leg of the round trip — what a piece of work is standing on.
//
// The Strategy binds its decisions, premises and success conditions to the
// Elements, Objects and Phases they touch (`intent_bindings`). Read only from
// the Strategy's side, an Element existed because of a decision and had no way
// to say so, and the person holding it never saw the premise that would fall
// over if they stopped. the product names this as
// the founding pain — "タスクはそもそもの意図を失っている" — and this model
// is the reading in the other direction.
//
// Pure on purpose: no React, no Supabase, no clock of its own. `now` is an
// argument so a review date can be tested without waiting for it.
// =============================================================

import type {
  Intent,
  IntentBinding,
  IntentBindingTarget,
  IntentRelationship,
} from '@/types/database';
import {
  decisionStatusLabel,
  isDueForReview,
  reviewLabel,
  toDecision,
  type DecisionStatus,
  type ReviewState,
} from '@/ActivitySpace/strategy/initiative/initiativeDecisionModel';

/** What the widget is about, plus the things it contains that a binding may
 *  land on instead — an Object's Elements. */
export interface TrailScope {
  subject: { type: IntentBindingTarget; id: string };
  /** id → the label to show when a binding reached the subject through it. */
  contained: Map<string, { type: IntentBindingTarget; label: string }>;
}

export interface TrailRow {
  intentId: string;
  kind: 'decision' | 'assumption' | 'measure';
  /** Another decision has reversed this one (`superseded_by_intent_id`): the
   *  reason this work stood on is no longer in force. */
  reversed: boolean;
  title: string;
  status: DecisionStatus;
  statusLabel: string;
  /** Decisions still in force. Null for an assumption, which has no review
   *  horizon, and for a closed decision, whose review day stopped mattering
   *  the moment it closed — the same gate `isDueForReview` applies. */
  review: { state: ReviewState; label: string; due: boolean } | null;
  /** Every reason the edge exists, first seen first, deduped. */
  relationships: IntentRelationship[];
  /** Set when the binding landed on something the subject contains rather
   *  than on the subject itself. Null means "bound to this directly". */
  via: string | null;
  initiativeId: string;
  initiativeName: string | null;
}

/** The kinds that can be a reason for work: a decision carried out, a premise
 *  tested, a success condition delivered. The root is scope, not a reason. */
function isTrailKind(kind: Intent['kind']): kind is 'decision' | 'assumption' | 'measure' {
  return kind === 'decision' || kind === 'assumption' || kind === 'measure';
}

function urgency(row: TrailRow): number {
  // A reason reversed under the work is the first thing to look at: the work
  // may no longer be needed, or needed differently.
  if (row.reversed) return 4;
  if (row.review?.due) return 3;
  if (row.status === 'off_track' || row.status === 'at_risk') return 2;
  if (row.status === 'done') return 0;
  return 1;
}

export function intentTrailRows(
  bindings: IntentBinding[],
  intents: Intent[],
  scope: TrailScope,
  initiativeNames: Map<string, string>,
  now: Date,
  /** intent id → ISO timestamp of its newest review. */
  lastReviewedAt: Map<string, string> = new Map(),
): TrailRow[] {
  const byId = new Map(intents.map((i) => [i.id, i]));

  // One row per intent, however many edges reach it. A decision bound to the
  // Object directly and to two of its Elements is one decision.
  const rows = new Map<string, { direct: boolean; vias: string[]; rels: IntentRelationship[] }>();

  for (const b of bindings) {
    const intent = byId.get(b.intent_id);
    if (!intent || !isTrailKind(intent.kind)) continue;

    let direct = false;
    let via: string | null = null;
    if (b.target_type === scope.subject.type && b.target_id === scope.subject.id) {
      direct = true;
    } else {
      const inner = scope.contained.get(b.target_id);
      if (!inner || inner.type !== b.target_type) continue; // not ours
      via = inner.label;
    }

    const acc = rows.get(intent.id) ?? { direct: false, vias: [], rels: [] };
    acc.direct = acc.direct || direct;
    if (via && !acc.vias.includes(via)) acc.vias.push(via);
    if (!acc.rels.includes(b.relationship_type)) acc.rels.push(b.relationship_type);
    rows.set(intent.id, acc);
  }

  const out: TrailRow[] = [];
  for (const [intentId, acc] of rows) {
    const intent = byId.get(intentId)!;
    const kind = intent.kind as TrailRow['kind'];

    const decision = toDecision(
      {
        id: intent.id,
        title: intent.title,
        abandoned: intent.abandoned,
        horizon: intent.horizon,
        status: intent.status,
        decidedBy: intent.decided_by_name,
        decidedAt: intent.decided_at,
        orderIndex: intent.order_index,
        lastReviewedAt: lastReviewedAt.get(intent.id) ?? null,
      },
      now,
    );

    // A binding on the subject itself outranks any that reached it through a
    // child: "this Object delivers the decision" is the stronger statement,
    // and naming the Element beside it would only muddy which one is meant.
    const via = acc.direct
      ? null
      : acc.vias.length === 1
        ? acc.vias[0]
        : `${acc.vias[0]} +${acc.vias.length - 1}`;

    out.push({
      intentId,
      kind,
      reversed: intent.superseded_by_intent_id != null,
      title: intent.title,
      status: decision.status,
      statusLabel: decisionStatusLabel(decision.status),
      review:
        kind === 'decision' && decision.review !== 'unset' && decision.status !== 'done'
          ? {
              state: decision.review,
              label: reviewLabel(decision),
              due: isDueForReview(decision),
            }
          : null,
      relationships: acc.rels,
      via,
      initiativeId: intent.strategy_id,
      initiativeName: initiativeNames.get(intent.strategy_id) ?? null,
    });
  }

  // What needs somebody today floats up; within a band, the Strategy's own
  // order, so the list reads the way its author arranged it. `order_index` is
  // per Strategy, so an Object contributing to two of them would interleave
  // by a number that means nothing across the pair — group by Strategy first.
  return out.sort((a, b) => {
    const u = urgency(b) - urgency(a);
    if (u !== 0) return u;
    const c = (a.initiativeName ?? '').localeCompare(b.initiativeName ?? '');
    if (c !== 0) return c;
    return byId.get(a.intentId)!.order_index - byId.get(b.intentId)!.order_index;
  });
}

/** The Strategies an Element serves when nothing names a reason for it: those
 *  its Objects belong to. Weaker than a bound reason, so shown only in its
 *  place — a person files work into an Object, not against a premise. */
export function strategiesOfObjects(
  strategies: readonly { id: string; name: string; objectIds: readonly string[] }[],
  objectIds: readonly string[],
): { id: string; name: string }[] {
  const mine = new Set(objectIds);
  return strategies
    .filter((s) => s.objectIds.some((o) => mine.has(o)))
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The verb the Strategy side attached to the edge, as a phrase. */
export const RELATIONSHIP_LABEL: Record<IntentRelationship, string> = {
  delivers: 'delivers',
  tests: 'could falsify',
  evidences: 'evidences',
  measures: 'measures',
  competes_with: 'competes for the same people',
  reschedules: 'rescheduled by',
};
