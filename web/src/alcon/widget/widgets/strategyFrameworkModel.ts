// =============================================================
// Strategy frameworks, read off the board rather than typed into it.
//
// The Campaign had a "Frameworks" slot that was three free-text boxes in
// localStorage: Goal, Gap, Current State. It could hold one framework, it had
// no column in `strategies`, and — the part that matters — nothing it said was
// connected to anything. A goal typed there and a measure recorded twenty
// pixels below it could contradict each other forever.
//
// A framework earns its place here only if it is a LENS over rows the board
// already holds. OKR and Gap both are: `intents` of kind `measure` already
// carry a target, a reading, a unit and a direction, which is an OKR key
// result and a gap in the same row. The frameworks that have no rows to stand
// on — 3C, PEST, a SWOT square — are not modelled here on purpose; they are
// prose about the outside world, and prose belongs in a Note.
//
// What this file will not do is score. `campaignMeasureModel` refuses to rank
// misses by magnitude because the units are the operator's — nine points of
// hand hygiene and three unclosed corrections are not on one scale — and a
// blended "OKR attainment %" is that same invented comparison wearing a
// percentage sign. Objectives report a tally of states, never an average.
//
// Pure on purpose: no React, no Supabase, no clock.
// =============================================================

import {
  orderMeasures,
  tallyMeasures,
  type Measure,
  type MeasureInput,
  type MeasureTally,
} from '@/alcon/element/actions/campaignMeasureModel';

/** One Campaign, as the OKR lens sees it. */
export interface ObjectiveInput {
  id: string;
  name: string;
  /** Campaign ids this one hangs under. Empty for a portfolio root. */
  parentIds: string[];
}

export interface Objective {
  id: string;
  name: string;
  /** 0 for the Campaign the widget is about; 1+ for nested Campaigns. */
  depth: number;
  /** Its own measures, worst-first — `orderMeasures`' ordering. */
  keyResults: Measure[];
  tally: MeasureTally;
  /**
   * True when this Objective states no key result at all.
   *
   * The classic OKR failure, and the only claim this lens makes that the
   * Measures section cannot: a Campaign can look busy — Objects, Elements,
   * decisions — while naming nothing that would tell anyone whether it
   * succeeded. Kept separate from `tally.total === 0` at the call site so the
   * reason a row is flagged is legible in the type.
   */
  stated: boolean;
}

/**
 * The Objective cascade under one Campaign.
 *
 * Depth-first through `strategy_children`, so a reader sees a parent and the
 * Campaigns it decomposes into in the order they nest. Cycles cannot render —
 * the table permits a DAG and nothing stops a loop being written — so a
 * Campaign already on the path is not descended into a second time.
 */
export function objectiveTree(
  rootId: string,
  campaigns: ObjectiveInput[],
  measuresByCampaign: Map<string, MeasureInput[]>,
): Objective[] {
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const childrenOf = new Map<string, ObjectiveInput[]>();
  for (const c of campaigns) {
    for (const parentId of c.parentIds) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(c);
      childrenOf.set(parentId, list);
    }
  }

  const out: Objective[] = [];
  const seen = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (seen.has(id)) return;
    seen.add(id);
    const campaign = byId.get(id);
    if (!campaign) return;

    const keyResults = orderMeasures(measuresByCampaign.get(id) ?? []);
    out.push({
      id,
      name: campaign.name,
      depth,
      keyResults,
      tally: tallyMeasures(keyResults),
      stated: keyResults.length > 0,
    });

    for (const child of childrenOf.get(id) ?? []) walk(child.id, depth + 1);
  };

  walk(rootId, 0);
  return out;
}

/**
 * How far a reading is from the condition it is judged against, as a fraction
 * of the bar the Gap lens draws.
 *
 * Both ends are the measure's own number, so nothing is compared across units.
 * The scale runs from zero to whichever of target/actual is larger, which
 * means the bar answers one question only — how much of the distance is
 * covered — and never implies that two rows' bars are on one scale.
 *
 * `at_most` is not inverted here. A target of "zero unclosed corrections" with
 * a reading of three is a bar that overshoots its mark, and drawing it that
 * way is the honest picture: the reader sees the overshoot rather than a bar
 * that is mysteriously short.
 */
export interface GapRow extends Measure {
  /** 0–1 of the drawn track for the reading, or null when there is none. */
  actualFraction: number | null;
  /** 0–1 of the drawn track for the target, or null when none is stated. */
  targetFraction: number | null;
  /** `actual - target`, or null when either is missing. Sign is meaningful:
   *  negative is short of an `at_least`, positive is over an `at_most`. */
  distance: number | null;
}

export function gapRows(inputs: MeasureInput[]): GapRow[] {
  return orderMeasures(inputs).map((measure) => {
    const { target, actual } = measure;
    const hasTarget = target !== null && Number.isFinite(target);
    const hasActual = actual !== null && Number.isFinite(actual);

    // The track has to hold both marks, and a zero target (a real condition —
    // "zero unclosed corrections") would divide by nothing.
    const span = Math.max(hasTarget ? Math.abs(target) : 0, hasActual ? Math.abs(actual) : 0);
    const fraction = (v: number) => (span === 0 ? 0 : Math.min(1, Math.abs(v) / span));

    return {
      ...measure,
      actualFraction: hasActual ? fraction(actual) : null,
      targetFraction: hasTarget ? fraction(target) : null,
      distance: hasTarget && hasActual ? actual - target : null,
    };
  });
}

/** `intents` rows narrowed to what a measure is, for either lens. */
export function toMeasureInput(row: {
  id: string;
  title: string;
  target_value: number | null;
  actual_value: number | null;
  unit: string | null;
  direction: MeasureInput['direction'];
  measured_at: string | null;
  order_index: number;
}): MeasureInput {
  return {
    id: row.id,
    title: row.title,
    target: row.target_value,
    actual: row.actual_value,
    unit: row.unit,
    direction: row.direction,
    measuredAt: row.measured_at,
    orderIndex: row.order_index,
  };
}
