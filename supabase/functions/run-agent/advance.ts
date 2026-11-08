// What happens after an AI finishes an Element under a Strategy that lets its
// AI work go on its own (delegation 'auto'): which Elements start next. Pure:
// index.ts reads the rows, this file decides.

export type Delegation = "manual" | "auto";

/** Pure. The delegation that applies to an Element: 'auto' only when every
 *  Strategy it serves allows it — one Strategy asking for review wins. */
export function delegationOf(strategies: { delegation: string | null }[]): Delegation {
  if (strategies.length === 0) return "manual";
  return strategies.every((s) => s.delegation === "auto") ? "auto" : "manual";
}

export interface AdvanceCandidate {
  id: string;
  status: string | null;
  /** Assigned to an AI Worker that runs here (not handed to Claude Code). */
  ai: boolean;
  /** Has a queued / running / waiting run already. */
  openRun: boolean;
  /**
   * A standing pass covers this Element (the unit-return rule, B3):
   * its latest judged work passed — or a person accepted it, readings
   * and all — over inputs provably unchanged since. Re-dispatch skips
   * it by record; what it already proved is not re-proved. Absent =
   * no standing pass (every caller before the rule read it this way).
   */
  standingPass?: boolean;
}

/**
 * Pure. The Elements to start now that `doneId` is done: those it unblocks
 * (depends_on edges from it) that are open, an AI's, not already running,
 * not covered by a standing pass, and whose every prerequisite is now
 * done or cancelled.
 */
export function readyDownstream(input: {
  doneId: string;
  edges: { from_element: string; to_element: string }[];
  candidates: AdvanceCandidate[];
  /** The status of every prerequisite of every candidate. */
  statusOf: ReadonlyMap<string, string | null>;
}): string[] {
  const byId = new Map(input.candidates.map((c) => [c.id, c]));
  // The finished Element counts as settled whether it was done or cancelled.
  const settled = (id: string) => {
    const s = id === input.doneId ? "done" : input.statusOf.get(id);
    return s === "done" || s === "cancelled";
  };
  const next = new Set<string>();
  for (const e of input.edges) {
    if (e.from_element !== input.doneId) continue;
    const c = byId.get(e.to_element);
    if (!c || !c.ai || c.openRun || c.standingPass) continue;
    if (!["todo", "backlog", null].includes(c.status)) continue;
    const prereqs = input.edges.filter((x) => x.to_element === c.id).map((x) => x.from_element);
    if (prereqs.every(settled)) next.add(c.id);
  }
  return [...next];
}
