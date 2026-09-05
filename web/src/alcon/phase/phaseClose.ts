// What it means for a Phase to be over, and what happens to the work that
// wasn't finished when it was.
//
// A Phase closes because somebody closes it. `status = 'complete'` records
// that act; `end_date` records what the plan said. Running out of time is the
// gap between the two, so it is derived here rather than stored — a third
// column could disagree with both, and then no one could say which was right.
//
// Everything below is pure so the Phase surface, its tests and the write
// planner all read the same rules. The writes themselves are in
// `hooks/useSupabase.ts`; this module only decides what they should be.

import type { ElementStatus, Phase, PhaseStatus } from '@/types/database';

/** Today on the viewer's own calendar, as the 'YYYY-MM-DD' the columns hold. */
export function todayYMD(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Where a Phase stands, folding the act (`status`) together with the plan
 * (the dates) into the one word a row can show.
 *
 * `out_of_time` is the reading this whole module exists for: past its last
 * day and still not closed. `end_date` is inclusive (`shared/phaseWindow.ts`),
 * so the final day is a working day inside the Phase, not the divider after
 * it — a Phase is out of time the day *after* its end date, never on it.
 */
export type PhaseStanding = 'planned' | 'active' | 'out_of_time' | 'complete';

export const PHASE_STANDING_LABEL: Record<PhaseStanding, string> = {
  planned: 'Planned',
  active: 'Active',
  out_of_time: 'Out of time',
  complete: 'Complete',
};

export type PhaseStandingInput = Pick<Phase, 'status' | 'start_date' | 'end_date'>;

export function phaseStanding(phase: PhaseStandingInput, today: string): PhaseStanding {
  if (phase.status === 'complete') return 'complete';
  if (phase.end_date && today > phase.end_date) return 'out_of_time';
  if (phase.status === 'active') return 'active';
  // A Phase nobody moved off `planned` is still running once its window has
  // opened — the dates say so, and asking a user to flip a switch to be told
  // what the calendar already knows is not a state worth having.
  if (phase.start_date && phase.start_date <= today) return 'active';
  return 'planned';
}

/** The next status a Phase can be put into by hand. Closing is its own flow. */
export const PHASE_STATUS_LABEL: Record<PhaseStatus, string> = {
  planned: 'Planned',
  active: 'Active',
  complete: 'Complete',
};

// ============================================
// Rollup
// ============================================

/** The Element shape these rules need; a full `Element` row satisfies it. */
export interface PhaseElementRow {
  id: string;
  status: ElementStatus | string | null;
  phase_id: string | null;
  carried_over_count?: number;
}

export interface PhaseRollup {
  /** Elements in the Phase that reached `done`. */
  done: number;
  /** Everything the Phase is still answerable for — `done` plus `unfinished`. */
  total: number;
  /** In the Phase, not settled: the work that has to go somewhere when it closes. */
  unfinished: number;
}

/**
 * Done over total for one Phase.
 *
 * `cancelled` counts as neither. A Phase that dropped two of its ten Elements
 * finished eight of eight, not eight of ten — leaving them in the denominator
 * puts a ceiling below 100% that no amount of work can lift, which makes the
 * number stop meaning anything.
 */
export function phaseRollup(elements: readonly PhaseElementRow[], phaseId: string): PhaseRollup {
  let done = 0;
  let unfinished = 0;
  for (const el of elements) {
    if (el.phase_id !== phaseId) continue;
    if (el.status === 'done') done += 1;
    else if (el.status !== 'cancelled') unfinished += 1;
  }
  return { done, total: done + unfinished, unfinished };
}

/** The Elements a close has to find a home for, in the order given. Generic
 *  over the row shape so a caller passing richer Elements (e.g. with `title`,
 *  for a UI that lists them) gets that shape back rather than the bare
 *  `PhaseElementRow` this module needs internally. */
export function unfinishedIn<T extends PhaseElementRow>(elements: readonly T[], phaseId: string): T[] {
  return elements.filter(
    (el) => el.phase_id === phaseId && el.status !== 'done' && el.status !== 'cancelled',
  );
}

// ============================================
// Closing
// ============================================

/**
 * Where unfinished Elements go when the Phase closes. There is no fourth
 * option and no default: carrying work forward silently empties the box for
 * the next round and destroys the only reading a time box gives you — that
 * this much did not get done. Somebody chooses, every time.
 */
export type CloseDestination = 'carry' | 'unassign' | 'keep';

/**
 * One `update ... where id in (...)` worth of Elements. Rows carrying the
 * same count can travel together, so the usual close — nothing carried before
 * — is a single write however many Elements it moves.
 */
export interface PhaseCloseWrite {
  phase_id: string | null;
  /** Omitted when the destination does not change how many rounds it has seen. */
  carried_over_count?: number;
  ids: string[];
}

/**
 * The Element writes a close implies, and nothing else — the `phases` row is
 * the caller's business.
 *
 * `carry` with no next Phase plans nothing rather than dropping the Elements
 * somewhere: the surface disables that choice when there is nowhere to carry
 * to, and a planner that quietly turned it into `unassign` would move work out
 * of a Phase the user never asked to empty.
 */
export function planPhaseClose(input: {
  elements: readonly PhaseElementRow[];
  phaseId: string;
  destination: CloseDestination;
  nextPhaseId?: string | null;
}): PhaseCloseWrite[] {
  const open = unfinishedIn(input.elements, input.phaseId);
  if (open.length === 0 || input.destination === 'keep') return [];
  if (input.destination === 'unassign') {
    return [{ phase_id: null, ids: open.map((el) => el.id) }];
  }
  if (!input.nextPhaseId) return [];

  const byCount = new Map<number, string[]>();
  for (const el of open) {
    const count = el.carried_over_count ?? 0;
    const ids = byCount.get(count);
    if (ids) ids.push(el.id);
    else byCount.set(count, [el.id]);
  }
  return [...byCount.entries()]
    .sort(([a], [b]) => a - b)
    .map(([count, ids]) => ({ phase_id: input.nextPhaseId!, carried_over_count: count + 1, ids }));
}

/**
 * The Phase work carries into: the next one still open, in the order the list
 * is already sorted by (start date, then creation). A closed Phase is skipped
 * — carrying into something that is itself over is how work disappears.
 */
export function nextOpenPhase(phases: readonly Phase[], currentId: string): Phase | null {
  const at = phases.findIndex((p) => p.id === currentId);
  if (at < 0) return null;
  for (let i = at + 1; i < phases.length; i++) {
    if (phases[i].status !== 'complete') return phases[i];
  }
  return null;
}
