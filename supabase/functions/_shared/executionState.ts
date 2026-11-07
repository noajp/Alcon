// Where a Strategy's work stands, read on the server. A line-for-line port
// of the web's missionModel.actionState / missionBarriers (the Execution
// Chain's own reading) over server row shapes, so the conversation's
// getInitiativeExecution answers with the same states the Chain shows.
// The agreement test (web/tests/executionState.test.ts) pins the two to
// the same fixtures: change one, the other must agree or the test says so.
// Pure: no client, no clock of its own (a lease's expiry is computed by
// the caller into `leased`).

export type ExecutionActionState = "done" | "running" | "waiting" | "blocked" | "failed" | "todo" | "cancelled";

/** An Element as the state reading needs it. `claudeCode` / `leased` are
 *  the caller's derivations from the Element's assignees and its claim
 *  columns — the same two facts the web row carries. */
export interface ExecutionElementRow {
  id: string;
  title: string;
  status: string | null;
  claudeCode?: boolean;
  leased?: boolean;
}

/** A run as the state reading needs it (the latest per Element). */
export interface ExecutionRunRow {
  element_id: string;
  status: string;
  summary: string | null;
  error: string | null;
  created_at: string;
}

/** Pure. The latest run per Element. */
export function latestRunsByElement(runs: readonly ExecutionRunRow[]): Map<string, ExecutionRunRow> {
  const out = new Map<string, ExecutionRunRow>();
  for (const r of runs) {
    const seen = out.get(r.element_id);
    if (!seen || r.created_at > seen.created_at) out.set(r.element_id, r);
  }
  return out;
}

/** Pure. Where an action stands. The Element's own status decides done /
 *  cancelled / blocked; an open run says it is moving or waiting on a
 *  person (asking for approval, waiting for an answer, or paused); a
 *  failed last run with the work still open says so. */
export function actionStateOf(element: ExecutionElementRow, run: ExecutionRunRow | undefined): ExecutionActionState {
  if (element.status === "done") return "done";
  if (element.status === "cancelled") return "cancelled";
  if (element.status === "blocked") return "blocked";
  // Claude Code work has no run row: a held lease is the session working on it.
  if (element.claudeCode) {
    if (element.status === "review") return "waiting";
    return element.leased ? "running" : "todo";
  }
  if (run) {
    if (run.status === "queued" || run.status === "running") return "running";
    if (run.status === "awaiting_approval" || run.status === "awaiting_input" || run.status === "paused") return "waiting";
    if (run.status === "failed") return "failed";
  }
  if (element.status === "review") return "waiting";
  if (element.status === "in_progress") return "running";
  return "todo";
}

export interface ExecutionBarrier {
  elementId: string;
  title: string;
  kind: "blocked" | "failed" | "waiting";
  detail: string | null;
}

/** Pure. What stops the work, worst first: blocked, then failed, then
 *  waiting — each with the run's own account of it. */
export function barriersOf(elements: readonly ExecutionElementRow[], runs: readonly ExecutionRunRow[]): ExecutionBarrier[] {
  const latest = latestRunsByElement(runs);
  const order: Record<ExecutionBarrier["kind"], number> = { blocked: 0, failed: 1, waiting: 2 };
  const out: ExecutionBarrier[] = [];
  for (const e of elements) {
    const run = latest.get(e.id);
    const state = actionStateOf(e, run);
    if (state !== "blocked" && state !== "failed" && state !== "waiting") continue;
    out.push({
      elementId: e.id,
      title: e.title,
      kind: state,
      detail: state === "failed" ? run?.error ?? null : run?.summary ?? run?.error ?? null,
    });
  }
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
