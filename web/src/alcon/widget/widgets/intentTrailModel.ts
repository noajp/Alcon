// =============================================================
// The return leg of the round trip — what a piece of work is standing on.
//
// The Campaign already binds decisions and assumptions to the Elements,
// Objects and Phases they touch (`intent_bindings`). Until now that edge could
// only be read from the Campaign's side: an Element existed because of a
// decision and had no way to say so, and the person holding it never saw the
// assumption that would fall over if they stopped. PRODUCT.md names this as
// the founding pain — "タスクはそもそもの意図を失っている" — and this model
// is the reading in the other direction.
//
// Pure on purpose: no React, no Supabase, no clock of its own. `now` is an
// argument so a review date can be tested without waiting for it.
// =============================================================

import type { Intent, IntentBinding, IntentBindingTarget, IntentRelationship } from '@/types/database';
import {
  decisionStatusLabel,
  reviewLabel,
  toDecision,
  type DecisionStatus,
  type ReviewState,
} from '@/alcon/element/actions/campaignDecisionModel';

/** What the widget is about, plus the things it contains that a binding may
 *  land on instead — an Object's Elements. */
export interface TrailScope {
  subject: { type: IntentBindingTarget; id: string };
  /** id → the label to show when a binding reached the subject through it. */
  contained: Map<string, { type: IntentBindingTarget; label: string }>;
}

export interface TrailRow {
  intentId: string;
  kind: 'decision' | 'assumption';
  title: string;
  status: DecisionStatus;
  statusLabel: string;
  /** Decisions only; `null` for an assumption, which has no review horizon. */
  review: { state: ReviewState; label: string } | null;
  /** Every reason the edge exists, first seen first, deduped. */
  relationships: IntentRelationship[];
  /** Set when the binding landed on something the subject contains rather
   *  than on the subject itself. Null means "bound to this directly". */
  via: string | null;
  campaignId: string;
  campaignName: string | null;
}

/** Only the two kinds a Campaign writes by hand. The root is scope, not
 *  intent; a measure is a number, which the Campaign's own section shows. */
function isTrailKind(kind: Intent['kind']): kind is 'decision' | 'assumption' {
  return kind === 'decision' || kind === 'assumption';
}

function urgency(row: TrailRow): number {
  if (row.review && (row.review.state === 'overdue' || row.review.state === 'today')) return 3;
  if (row.status === 'off_track' || row.status === 'at_risk') return 2;
  if (row.status === 'done') return 0;
  return 1;
}

export function intentTrailRows(
  bindings: IntentBinding[],
  intents: Intent[],
  scope: TrailScope,
  campaignNames: Map<string, string>,
  now: Date,
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
    const kind = intent.kind as 'decision' | 'assumption';

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
      title: intent.title,
      status: decision.status,
      statusLabel: decisionStatusLabel(decision.status),
      review:
        kind === 'decision' && decision.review !== 'unset'
          ? { state: decision.review, label: reviewLabel(decision) }
          : null,
      relationships: acc.rels,
      via,
      campaignId: intent.strategy_id,
      campaignName: campaignNames.get(intent.strategy_id) ?? null,
    });
  }

  // What needs somebody today floats up; within a band, the Campaign's own
  // order, so the list reads the way its author arranged it.
  return out.sort((a, b) => {
    const u = urgency(b) - urgency(a);
    if (u !== 0) return u;
    const oa = byId.get(a.intentId)!.order_index;
    const ob = byId.get(b.intentId)!.order_index;
    return oa - ob;
  });
}

/** The verb the Campaign side attached to the edge, as a phrase. */
export const RELATIONSHIP_LABEL: Record<IntentRelationship, string> = {
  delivers: 'delivers',
  tests: 'could falsify',
  evidences: 'evidences',
  measures: 'measures',
  competes_with: 'competes for the same people',
  reschedules: 'rescheduled by',
};
