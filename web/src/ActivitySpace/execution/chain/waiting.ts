import type { AgentRunStatus, Element } from '@/types/database';
import { isElementAction, isHumanAction } from '@/Function/shared/elementActionKinds';
import {
  latestRuns,
  type ActionState, type FleetObject, type MissionElementRow, type MissionRunRow,
} from '@/ActivitySpace/strategy/initiative/mission/missionModel';

// Why an Element waits, as one pure reading of the facts the chain already
// has: the Element's own status and verb, its latest run (status, verdict's
// held readings, its own words), and the predecessors still open. The card's
// chip, the Strategy strip's "Waiting on you" count and the chain's filters
// all read this one function, so a count and the cards it counts can never
// disagree.
//
// waitsOnPerson below is the same definition at the shallower depth the
// Board has (an Element and its latest run's *status* only): one
// definition, two depths of input.

export type WaitingReasonKind =
  | 'approval'    // latest run is awaiting_approval
  | 'answer'      // latest run is awaiting_input
  | 'readings'    // latest run finished; some proposed readings are held for acceptance
  | 'review'      // work sits in review (run awaiting_review, or Element status review)
  | 'verb'        // the Element's verb is a person's (judge/decide/approve/answer)
  | 'blocked'     // Element status blocked
  | 'paused'      // latest run paused — resumable by its starter
  | 'dependency'; // open work whose predecessors are not done — waits on work, not a person

export interface WaitingReason {
  kind: WaitingReasonKind;
  /** A person's act is what unblocks this. Drives the warning tone and the
   *  strip's "Waiting on you" count. False only for 'dependency'. */
  needsPerson: boolean;
  /** The run behind the reason, when there is one. */
  runId: string | null;
  /** For 'readings': how many proposals are held. */
  heldReadings: number;
  /** The run's own words — its error (paused) or summary (the question it
   *  asked, for 'answer'; why it stopped, for 'approval') — for the chip's
   *  title/detail line. */
  detail: string | null;
}

/** Pure. Why this Element waits, or null when it waits on nothing. The
 *  precedence is the person's triage order — the act only they can do,
 *  before the state of the work. A failed verdict is deliberately not a
 *  reason: it has its own card line, strip segment and filter. */
export function waitingReason(input: {
  element: Pick<MissionElementRow, 'status' | 'action'>;
  latestRun: MissionRunRow | null | undefined;
  blockers: readonly { state: ActionState }[];
}): WaitingReason | null {
  const { element } = input;
  if (element.status === 'done' || element.status === 'cancelled') return null;
  const run = input.latestRun ?? null;
  if (run?.status === 'awaiting_approval') {
    return { kind: 'approval', needsPerson: true, runId: run.id || null, heldReadings: 0, detail: run.summary };
  }
  if (run?.status === 'awaiting_input') {
    return { kind: 'answer', needsPerson: true, runId: run.id || null, heldReadings: 0, detail: run.summary };
  }
  const held = (run?.proposed_readings ?? [])
    .filter((p) => !p.applied && p.heldReason === 'awaiting-acceptance').length;
  if (run && held > 0) {
    return { kind: 'readings', needsPerson: true, runId: run.id || null, heldReadings: held, detail: null };
  }
  if (run?.status === 'awaiting_review' || element.status === 'review') {
    return {
      kind: 'review', needsPerson: true,
      runId: run?.status === 'awaiting_review' ? run.id || null : null,
      heldReadings: 0, detail: null,
    };
  }
  if (isElementAction(element.action) && isHumanAction(element.action)) {
    return { kind: 'verb', needsPerson: true, runId: null, heldReadings: 0, detail: null };
  }
  if (element.status === 'blocked') {
    return { kind: 'blocked', needsPerson: true, runId: null, heldReadings: 0, detail: null };
  }
  if (run?.status === 'paused') {
    return { kind: 'paused', needsPerson: true, runId: run.id || null, heldReadings: 0, detail: run.error };
  }
  if (input.blockers.length > 0) {
    return { kind: 'dependency', needsPerson: false, runId: null, heldReadings: 0, detail: null };
  }
  return null;
}

/** Pure. The waiting reason of every written Element in a fleet, keyed by
 *  Element id — the map the Strategy strip counts from and the chain filter
 *  reads, so both agree with the cards' chips by construction. */
export function waitingReasonsByElement(
  fleet: readonly FleetObject[],
  runs: readonly MissionRunRow[],
): Map<string, WaitingReason | null> {
  const latest = latestRuns(runs);
  const out = new Map<string, WaitingReason | null>();
  for (const o of fleet) {
    for (const e of o.elements) {
      if (!e.elementId) continue;
      out.set(e.elementId, waitingReason({ element: e, latestRun: latest.get(e.elementId), blockers: e.blockers }));
    }
  }
  return out;
}

/** Pure. True when the Element waits on a person — waitingReason at the
 *  depth the Board call site has: no blockers, no readings, the latest
 *  run's status only (a status-only stub; the run-derived reasons it can
 *  still name are approval / answer / review / paused). */
export function waitsOnPerson(
  element: Pick<Element, 'status' | 'action'>,
  latestRun: AgentRunStatus | null | undefined,
): boolean {
  const stub: MissionRunRow | null = latestRun == null ? null : {
    id: '', element_id: '', status: latestRun, input_tokens: 0, output_tokens: 0,
    cost_usd: 0, summary: null, error: null, created_at: '', verdict: null, proposed_readings: null,
  };
  const action = isElementAction(element.action) ? element.action : null;
  return waitingReason({ element: { status: element.status, action }, latestRun: stub, blockers: [] })?.needsPerson ?? false;
}
