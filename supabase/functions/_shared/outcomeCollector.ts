// Outcome records (B4): the measurement foundation. Every finished run
// leaves one record pairing what the machine judged (its sealed verdict,
// revisions, cost, approvals, readings) with what the human eventually
// did — and it is written by code, from source-of-truth rows, never by
// the model whose work it judges. A system that lets the worker grade
// its own homework has no learning edge, only a diary.
//
// This file is the deterministic collector the automations tick runs
// beside the heartbeat's section ($0 when nothing changed):
//
//   1. Settle pass — a run that reached a terminal settle (finished_at
//      stamped, status completed / awaiting_review / failed) and has no
//      outcome row yet gets its machine half, derived from the run's own
//      sealed record: the verdict jsonb, cost, its agent_actions, its
//      proposed_readings, and the definition it worked under (resolved
//      the driver's way — the Element's own enabled definition, else
//      its Strategies' — from the current links, the same attribution
//      the promotion material assembler already makes; a rehearsal's
//      definition is a draft body, not a row, so it stays null).
//   2. Signal pass — an outcome still reading human_signal 'none' is
//      checked against the human acts that already exist as sealed
//      records, in the design's strength order (§3.2): an approval
//      rejection (agent_actions), an acceptance (readings applied at a
//      person's close, or the person's own close of the Element), a
//      review send-back, a reopen, a promotion rollback
//      (promotion_drafts events). The first source in that order that
//      has spoken fills the block ONCE; it is never rewritten after —
//      later corrections live in the audit, not as edits here. Absence
//      is a value: past the signal horizon the record stands as 'none'
//      forever, never back-filled with an inference.
//   3. Rollup pass — outcome_rollups are recomputed from run_outcomes
//      over trailing day-bucketed windows (7d / 28d) for the scopes the
//      consumers read: definition, connector command, Space. Refreshed,
//      never hand-written; recomputation from the same rows yields the
//      same rows, so a re-run of the tick changes nothing.
//
// Pure builders first; the database shell at the bottom is thin.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { parseRunVerdict } from "./runVerdict.ts";
import { parseProposedReadings, type ProposedReading } from "./readingsGate.ts";
import { resolveDefinition, type DefinitionCandidate } from "./definitionResolution.ts";
import { activeConstraintIdsAt } from "./constraintDrafts.ts";

// ── Shapes, as fetched ────────────────────────────────────────────────

export interface OutcomeRunRow {
  id: string;
  element_id: string | null;
  strategy_id: string | null;
  activity_space_id: string | null;
  mode: string | null;
  status: string;
  verdict: unknown;
  proposed_readings: unknown;
  cost_usd: number | string | null;
  finished_at: string | null;
  /** When the run began — the moment the constraints it ran under
   *  are judged against (B6's evidence stamp). */
  created_at?: string | null;
  rehearsal?: boolean | null;
  integration_draft_id?: string | null;
  promotion_draft_id?: string | null;
  ai_session_id?: string | null;
}

export interface OutcomeActionRow {
  run_id: string;
  status: string;
  decision_source: string | null;
  decided_by: string | null;
  decided_at: string | null;
  integration_id: string | null;
  tool: string;
}

export interface OutcomeInsert {
  run_id: string;
  element_id: string | null;
  strategy_id: string | null;
  activity_space_id: string | null;
  driver: string;
  definition_id: string | null;
  definition_version: number | null;
  outcome: "completed" | "partial" | "blocked" | null;
  verdict_result: "pass" | "fail" | "unchecked" | null;
  verdict_reason: string | null;
  revisions: number;
  cost_usd: number;
  approvals_asked: number;
  approvals_approved: number;
  approvals_rejected: number;
  approvals_policy: number;
  readings_applied: number;
  readings_held: number;
  finished_at: string;
  human_signal: "none";
  signal_source: null;
  signal_at: null;
  signal_by: null;
}

/** The run's driver, mirroring run-agent/dispatch.ts driverForRun —
 *  the same subject dispatch, so an outcome names the driver the engine
 *  itself would name. */
export function driverKindOf(run: Pick<OutcomeRunRow, "element_id" | "strategy_id" | "integration_draft_id" | "promotion_draft_id" | "ai_session_id" | "mode">): string {
  if (run.element_id) return "execute";
  if (run.strategy_id) return "converse";
  if (run.integration_draft_id) return "draft";
  if (run.promotion_draft_id) return "promote";
  if (run.ai_session_id || run.mode === "copilot") return "chat";
  if (run.mode === "heartbeat") return "heartbeat";
  return "execute";
}

/** Whether an action was decided by a standing policy rather than a
 *  person: the Space's free mode ('policy') or an earned track-record
 *  grant ('track-record', B7). Both are counted as policy, never as a
 *  person's ask or approval — the distinction between them lives on
 *  the row, not in these counts. */
const isPolicyDecision = (source: string | null): boolean => source === "policy" || source === "track-record";

/** Pure. The approval counts of one run, from its agent_actions rows.
 *  Asked / approved / rejected count a person's proposals only; a policy
 *  approval (decision_source 'policy' — the Space's mode ran the call
 *  without asking — or 'track-record', an earned grant) is its own
 *  count, never laundered into "approved". */
export function approvalCountsOf(actions: readonly OutcomeActionRow[]): Pick<OutcomeInsert, "approvals_asked" | "approvals_approved" | "approvals_rejected" | "approvals_policy"> {
  let asked = 0, approved = 0, rejected = 0, policy = 0;
  for (const a of actions) {
    if (isPolicyDecision(a.decision_source)) { policy += 1; continue; }
    asked += 1;
    if (a.status === "rejected") rejected += 1;
    else if (a.status === "approved" || a.status === "executed" || a.status === "failed") approved += 1;
  }
  return { approvals_asked: asked, approvals_approved: approved, approvals_rejected: rejected, approvals_policy: policy };
}

/** Pure. Readings counts from a run's sealed proposals: how many landed,
 *  how many never did (held for acceptance, held by the gate, unbound,
 *  or failed to write — all still "held" from the record's side). */
export function readingsCountsOf(readings: readonly ProposedReading[]): Pick<OutcomeInsert, "readings_applied" | "readings_held"> {
  let applied = 0;
  for (const r of readings) if (r.applied) applied += 1;
  return { readings_applied: applied, readings_held: readings.length - applied };
}

/**
 * Pure. The machine half of one run's outcome, from its sealed record.
 * `definition` is the definition the collector resolved for the run
 * (id + the catalog version its copy came from — a hand-written or
 * locally edited definition honestly records null, the library's own
 * "version not recorded" posture), or null for ad-hoc work.
 */
export function machineHalfOf(args: {
  run: OutcomeRunRow;
  actions: readonly OutcomeActionRow[];
  definition: { id: string; sourceVersion: number | null } | null;
  strategyId: string | null;
}): OutcomeInsert {
  const { run, actions } = args;
  const verdict = parseRunVerdict(run.verdict);
  const readings = parseProposedReadings(run.proposed_readings) ?? [];
  return {
    run_id: run.id,
    element_id: run.element_id,
    strategy_id: args.strategyId,
    activity_space_id: run.activity_space_id,
    driver: driverKindOf(run),
    definition_id: args.definition?.id ?? null,
    definition_version: args.definition?.sourceVersion ?? null,
    outcome: verdict ? verdict.outcome
      : run.status === "completed" || run.status === "awaiting_review" ? "completed"
      : null,
    verdict_result: verdict ? verdict.result : null,
    verdict_reason: verdict ? verdict.reason : null,
    revisions: verdict ? verdict.revisions : 0,
    cost_usd: Number(run.cost_usd || 0),
    ...approvalCountsOf(actions),
    ...readingsCountsOf(readings),
    finished_at: run.finished_at!,
    human_signal: "none",
    signal_source: null,
    signal_at: null,
    signal_by: null,
  };
}

// ── The human signal ──────────────────────────────────────────────────

export type HumanSignal = "accepted" | "rejected" | "rework";
export type SignalSource = "approval" | "acceptance" | "review" | "reopen" | "rollback";

export interface SignalCandidate {
  signal: HumanSignal;
  source: SignalSource;
  at: string;
  by: string | null;
}

export interface ElementActivityRow {
  element_id: string;
  detail: string;
  actor_id: string | null;
  created_at: string;
}

/** Pure. An element_activity status detail ('review → done') read as
 *  its transition; null for anything that is not one. */
export function statusTransitionOf(detail: string): { from: string; to: string } | null {
  const parts = detail.split(" → ");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { from: parts[0], to: parts[1] };
}

/** Pure. Whether `runId` is the latest finished run on its Element at
 *  time `at` — an Element-level human act belongs to the run whose work
 *  was standing when it happened, never to an older superseded run. */
export function isLatestFinishedAt(finishedRuns: readonly { id: string; finished_at: string }[], runId: string, at: string): boolean {
  let latest: { id: string; finished_at: string } | null = null;
  for (const r of finishedRuns) {
    if (r.finished_at > at) continue;
    if (!latest || r.finished_at > latest.finished_at) latest = r;
  }
  return latest?.id === runId;
}

const WORKING_AGAIN = ["todo", "in_progress"];

/**
 * Pure. Every human act that speaks about one run, from the sealed
 * records around it — unsorted; pickSignal decides. Sources:
 *   approval   — a person rejected one of the run's proposed writes.
 *                (An approval is a permit, not a verdict on the work;
 *                it is counted on the row, never the signal.)
 *   acceptance — the run's held readings landed at a person's close
 *                (applied after the finish — the readings gate's own
 *                record names the closer and the moment), or the
 *                person closed the Element done themselves while this
 *                run's work was standing. Readings applied AT the
 *                finish are the gate's act, not a person's.
 *   review     — a person sent the standing work back from review to
 *                a working status.
 *   reopen     — a person took the Element out of done while this
 *                run's work was standing (the accepted-looking finish
 *                failed a human on inspection).
 *   rollback   — a promotion born of this run was rolled back; the
 *                draft's own event log names when and by whom.
 */
export function signalCandidatesOf(args: {
  run: Pick<OutcomeRunRow, "id" | "element_id" | "finished_at">;
  actions: readonly OutcomeActionRow[];
  readings: readonly ProposedReading[];
  activities: readonly ElementActivityRow[];
  /** Every finished run on the same Element (id + finished_at). */
  elementFinishedRuns: readonly { id: string; finished_at: string }[];
  rollbacks: readonly { at: string; by: string | null }[];
}): SignalCandidate[] {
  const { run, actions, readings, activities, elementFinishedRuns, rollbacks } = args;
  const finishedAt = run.finished_at!;
  const out: SignalCandidate[] = [];

  for (const a of actions) {
    if (isPolicyDecision(a.decision_source)) continue;
    if (a.status === "rejected" && a.decided_at) {
      out.push({ signal: "rejected", source: "approval", at: a.decided_at, by: a.decided_by });
    }
  }

  for (const r of readings) {
    if (r.applied && r.appliedAt && r.appliedAt > finishedAt) {
      out.push({ signal: "accepted", source: "acceptance", at: r.appliedAt, by: r.appliedBy });
    }
  }

  for (const act of activities) {
    if (!act.actor_id || act.created_at <= finishedAt) continue;
    if (!isLatestFinishedAt(elementFinishedRuns, run.id, act.created_at)) continue;
    const t = statusTransitionOf(act.detail);
    if (!t) continue;
    if (t.to === "done") {
      out.push({ signal: "accepted", source: "acceptance", at: act.created_at, by: act.actor_id });
    } else if (t.from === "review" && WORKING_AGAIN.includes(t.to)) {
      out.push({ signal: "rework", source: "review", at: act.created_at, by: act.actor_id });
    } else if (t.from === "done" && [...WORKING_AGAIN, "review", "blocked"].includes(t.to)) {
      out.push({ signal: "rework", source: "reopen", at: act.created_at, by: act.actor_id });
    }
  }

  for (const rb of rollbacks) {
    out.push({ signal: "rejected", source: "rollback", at: rb.at, by: rb.by });
  }

  return out;
}

/** The design's strength order (§3.2): the first source in this order
 *  that has spoken fills the block; within a source, the earliest act. */
const SOURCE_ORDER: readonly SignalSource[] = ["approval", "acceptance", "review", "reopen", "rollback"];

/** Pure. The one signal an outcome records, or null when no human act
 *  speaks yet. */
export function pickSignal(candidates: readonly SignalCandidate[]): SignalCandidate | null {
  for (const source of SOURCE_ORDER) {
    let best: SignalCandidate | null = null;
    for (const c of candidates) {
      if (c.source !== source) continue;
      if (!best || c.at < best.at) best = c;
    }
    if (best) return best;
  }
  return null;
}

// ── Rollups ───────────────────────────────────────────────────────────

export const ROLLUP_WINDOWS_DAYS = [7, 28] as const;

export interface RollupRow {
  scope_kind: "definition" | "connector_command" | "space";
  scope_id: string;
  window_start: string;
  window_days: number;
  counts: Record<string, number>;
}

/** Pure. The start of the trailing N-day window containing `now`,
 *  bucketed to the UTC day so every refresh in a day names the same
 *  row (and a re-run recomputes it identically). */
export function windowStartOf(now: Date, days: number): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString();
}

const emptyOutcomeCounts = (): Record<string, number> => ({
  runs: 0, completed: 0, partial: 0, blocked: 0, failed: 0, no_finish: 0,
  verdict_pass: 0, verdict_fail: 0, verdict_unchecked: 0, verdict_none: 0,
  signal_accepted: 0, signal_rejected: 0, signal_rework: 0, signal_none: 0,
  approvals_asked: 0, approvals_approved: 0, approvals_rejected: 0, approvals_policy: 0,
  readings_applied: 0, readings_held: 0, revisions: 0, cost_usd: 0,
});

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Pure. Every rollup row for the outcomes (and their runs' actions) in
 * the trailing windows ending at `now`. Windows filter by the run's
 * finished_at. Connector-command counts come from the actions of runs
 * finished in the window — asked/approved/rejected/policy are the
 * person's and the mode's decisions, executed/failed their landings.
 */
export function rollupRowsOf(args: {
  outcomes: readonly (OutcomeInsert & { human_signal: string })[];
  runStatus: ReadonlyMap<string, string>;
  actions: readonly OutcomeActionRow[];
  now: Date;
}): RollupRow[] {
  const rows: RollupRow[] = [];
  for (const days of ROLLUP_WINDOWS_DAYS) {
    const start = windowStartOf(args.now, days);
    const end = new Date(new Date(start).getTime() + days * 86_400_000).toISOString();
    const inWindow = (iso: string) => iso >= start && iso < end;

    const byScope = new Map<string, Record<string, number>>();
    const addTo = (kind: RollupRow["scope_kind"], scopeId: string | null, o: (typeof args.outcomes)[number]) => {
      if (!scopeId) return;
      const key = `${kind}:${scopeId}`;
      const c = byScope.get(key) ?? emptyOutcomeCounts();
      c.runs += 1;
      if (o.outcome) c[o.outcome] += 1;
      else if (args.runStatus.get(o.run_id) === "failed") c.failed += 1;
      else c.no_finish += 1;
      if (o.verdict_result) c[`verdict_${o.verdict_result}`] += 1; else c.verdict_none += 1;
      c[`signal_${o.human_signal}`] += 1;
      c.approvals_asked += o.approvals_asked;
      c.approvals_approved += o.approvals_approved;
      c.approvals_rejected += o.approvals_rejected;
      c.approvals_policy += o.approvals_policy;
      c.readings_applied += o.readings_applied;
      c.readings_held += o.readings_held;
      c.revisions += o.revisions;
      c.cost_usd = round6(c.cost_usd + o.cost_usd);
      byScope.set(key, c);
    };
    for (const o of args.outcomes) {
      if (!inWindow(o.finished_at)) continue;
      addTo("space", o.activity_space_id, o);
      addTo("definition", o.definition_id, o);
    }
    for (const [key, counts] of byScope) {
      const [kind, ...rest] = key.split(":");
      rows.push({ scope_kind: kind as RollupRow["scope_kind"], scope_id: rest.join(":"), window_start: start, window_days: days, counts });
    }

    // Connector commands: one scope per (integration, tool) the actions
    // name. A person's batch row ('batch') names no single command, so
    // it is counted in the run's outcome — never invented into one.
    const byCommand = new Map<string, Record<string, number>>();
    const finishedByRun = new Map(args.outcomes.filter((o) => inWindow(o.finished_at)).map((o) => [o.run_id, o.finished_at]));
    const runsByCommand = new Map<string, Set<string>>();
    for (const a of args.actions) {
      if (!a.integration_id || a.tool === "batch" || !finishedByRun.has(a.run_id)) continue;
      const key = `${a.integration_id}:${a.tool}`;
      const c = byCommand.get(key) ?? { actions: 0, asked: 0, approved: 0, rejected: 0, policy: 0, executed: 0, failed: 0, pending: 0, runs: 0 };
      c.actions += 1;
      if (isPolicyDecision(a.decision_source)) c.policy += 1;
      else {
        c.asked += 1;
        if (a.status === "rejected") c.rejected += 1;
        else if (a.status === "approved" || a.status === "executed" || a.status === "failed") c.approved += 1;
        else if (a.status === "pending") c.pending += 1;
      }
      if (a.status === "executed") c.executed += 1;
      if (a.status === "failed") c.failed += 1;
      const set = runsByCommand.get(key) ?? new Set<string>();
      set.add(a.run_id);
      runsByCommand.set(key, set);
      byCommand.set(key, c);
    }
    for (const [key, counts] of byCommand) {
      counts.runs = runsByCommand.get(key)?.size ?? 0;
      rows.push({ scope_kind: "connector_command", scope_id: key, window_start: start, window_days: days, counts });
    }
  }
  return rows;
}

// ── The collector (database shell) ────────────────────────────────────

const SETTLE_PER_TICK = 50;
const SIGNALS_PER_TICK = 100;
/** Signals are chased for this long after a finish; the design's
 *  clusters read trailing 28d, and a week of slack covers a slow
 *  acceptance. Past it the record stands as 'none' — absence is a
 *  value, and leaving it open forever would rescan it every tick. */
export const SIGNAL_HORIZON_DAYS = 35;
const TERMINAL_STATUSES = ["completed", "awaiting_review", "failed"];

interface DefinitionRow { id: string; enabled: boolean; source_version: number | null }

/** Resolves the definitions the given runs worked under, the driver's
 *  way (loadDefinition's rule), returning run_id → {id, sourceVersion}. */
async function resolveRunDefinitions(
  admin: SupabaseClient,
  runs: readonly OutcomeRunRow[],
): Promise<Map<string, { id: string; sourceVersion: number | null }>> {
  const out = new Map<string, { id: string; sourceVersion: number | null }>();
  const elementIds = [...new Set(runs.map((r) => r.element_id).filter((x): x is string => !!x))];
  const elements = new Map<string, { definition_id: string | null; object_id: string | null }>();
  if (elementIds.length) {
    const { data } = await admin.from("elements").select("id, definition_id, object_id").in("id", elementIds);
    for (const e of (data ?? []) as { id: string; definition_id: string | null; object_id: string | null }[]) {
      elements.set(e.id, { definition_id: e.definition_id, object_id: e.object_id });
    }
  }
  const objectIds = [...new Set([...elements.values()].map((e) => e.object_id).filter((x): x is string => !!x))];
  const strategyIdsByObject = new Map<string, string[]>();
  if (objectIds.length) {
    const { data } = await admin.from("strategy_objects").select("strategy_id, object_id").in("object_id", objectIds);
    for (const l of (data ?? []) as { strategy_id: string; object_id: string }[]) {
      const list = strategyIdsByObject.get(l.object_id) ?? [];
      list.push(l.strategy_id);
      strategyIdsByObject.set(l.object_id, list);
    }
  }
  const strategyIds = [...new Set([
    ...runs.map((r) => r.strategy_id).filter((x): x is string => !!x),
    ...[...strategyIdsByObject.values()].flat(),
  ])];
  const strategies = new Map<string, { definition_id: string | null }>();
  if (strategyIds.length) {
    const { data } = await admin.from("strategies").select("id, definition_id").in("id", strategyIds);
    for (const s of (data ?? []) as { id: string; definition_id: string | null }[]) {
      strategies.set(s.id, { definition_id: s.definition_id });
    }
  }
  const definitionIds = [...new Set([
    ...[...elements.values()].map((e) => e.definition_id),
    ...[...strategies.values()].map((s) => s.definition_id),
  ].filter((x): x is string => !!x))];
  const definitions = new Map<string, DefinitionRow>();
  if (definitionIds.length) {
    const { data } = await admin.from("definitions").select("id, enabled, source_version").in("id", definitionIds);
    for (const d of (data ?? []) as DefinitionRow[]) definitions.set(d.id, d);
  }
  const candidateOf = (id: string | null): DefinitionCandidate | null => {
    if (!id) return null;
    const d = definitions.get(id);
    return d ? { id: d.id, name: "", enabled: d.enabled } : null;
  };

  for (const run of runs) {
    if (run.rehearsal) continue; // a trial's definition is a draft body, not a row
    let resolved: string | null = null;
    if (run.element_id) {
      const el = elements.get(run.element_id);
      if (el) {
        const ownId = el.definition_id;
        const linked = [...new Set((el.object_id ? strategyIdsByObject.get(el.object_id) ?? [] : []))].sort();
        const candidates: (DefinitionCandidate | null)[] = [candidateOf(ownId)];
        for (const sid of linked) {
          const defId = strategies.get(sid)?.definition_id ?? null;
          if (defId && defId !== ownId) candidates.push(candidateOf(defId));
        }
        resolved = resolveDefinition(candidates).id;
      }
    } else if (run.strategy_id) {
      const defId = strategies.get(run.strategy_id)?.definition_id ?? null;
      resolved = resolveDefinition([candidateOf(defId)]).id;
    }
    if (resolved) {
      const d = definitions.get(resolved);
      if (d) out.set(run.id, { id: d.id, sourceVersion: d.source_version });
    }
  }
  return out;
}

/** The Strategy an outcome names: the run's own subject where it has
 *  one, else the single Strategy its Element serves (a run serving
 *  several names none — attribution stays honest rather than picked). */
function strategyIdOf(run: OutcomeRunRow, linkedByElement: ReadonlyMap<string, string[]>): string | null {
  if (run.strategy_id) return run.strategy_id;
  if (!run.element_id) return null;
  const linked = linkedByElement.get(run.element_id) ?? [];
  return linked.length === 1 ? linked[0] : null;
}

/**
 * One pass of the collector. Returns what it did; a pass over a settled
 * world returns zeroes and writes nothing but the rollup refresh its
 * window slide requires.
 */
export async function collectOutcomes(
  admin: SupabaseClient,
  now: Date,
): Promise<{ inserted: number; signalled: number; rollups: number }> {
  let inserted = 0, signalled = 0, rollups = 0;

  // ── 1. Settle pass ──────────────────────────────────────────────────
  const { data: settled } = await admin.from("agent_runs")
    .select("id, element_id, strategy_id, activity_space_id, mode, status, verdict, proposed_readings, cost_usd, finished_at, created_at, rehearsal, integration_draft_id, promotion_draft_id, ai_session_id")
    .not("finished_at", "is", null).in("status", TERMINAL_STATUSES)
    .order("finished_at", { ascending: true }).limit(SETTLE_PER_TICK);
  const settledRuns = (settled ?? []) as unknown as OutcomeRunRow[];
  if (settledRuns.length) {
    const runIds = settledRuns.map((r) => r.id);
    const { data: existing } = await admin.from("run_outcomes").select("run_id").in("run_id", runIds);
    const have = new Set(((existing ?? []) as { run_id: string }[]).map((r) => r.run_id));
    const fresh = settledRuns.filter((r) => !have.has(r.id));
    if (fresh.length) {
      const freshIds = fresh.map((r) => r.id);
      const { data: actionRows } = await admin.from("agent_actions")
        .select("run_id, status, decision_source, decided_by, decided_at, integration_id, tool")
        .in("run_id", freshIds);
      const actionsByRun = new Map<string, OutcomeActionRow[]>();
      for (const a of (actionRows ?? []) as OutcomeActionRow[]) {
        const list = actionsByRun.get(a.run_id) ?? [];
        list.push(a);
        actionsByRun.set(a.run_id, list);
      }
      const definitions = await resolveRunDefinitions(admin, fresh);
      // The Strategy each Element serves, for strategy_id attribution.
      const linkedByElement = new Map<string, string[]>();
      const freshElementIds = [...new Set(fresh.map((r) => r.element_id).filter((x): x is string => !!x))];
      if (freshElementIds.length) {
        const { data: els } = await admin.from("elements").select("id, object_id").in("id", freshElementIds);
        const objectIds = [...new Set(((els ?? []) as { object_id: string | null }[]).map((e) => e.object_id).filter((x): x is string => !!x))];
        if (objectIds.length) {
          const { data: links } = await admin.from("strategy_objects").select("strategy_id, object_id").in("object_id", objectIds);
          const byObject = new Map<string, string[]>();
          for (const l of (links ?? []) as { strategy_id: string; object_id: string }[]) {
            const list = byObject.get(l.object_id) ?? [];
            if (!list.includes(l.strategy_id)) list.push(l.strategy_id);
            byObject.set(l.object_id, list);
          }
          for (const e of (els ?? []) as { id: string; object_id: string | null }[]) {
            linkedByElement.set(e.id, e.object_id ? (byObject.get(e.object_id) ?? []) : []);
          }
        }
      }
      const rows = fresh.map((run) => machineHalfOf({
        run,
        actions: actionsByRun.get(run.id) ?? [],
        definition: definitions.get(run.id) ?? null,
        strategyId: strategyIdOf(run, linkedByElement),
      }));
      // B6's evidence stamp: the constraints this run ran under,
      // judged at the run's own start (activated before it, not yet
      // retired) — the record B6's effect evaluator attributes the
      // outcome to. Read failure-tolerantly: a Space without the
      // constraints tables yet (preview replay) stamps nothing and
      // the collector's own work is never hostage to it.
      let constraintRows: { id: string; scope: "definition" | "strategy"; target_definition_id: string | null; target_strategy_id: string | null; activated_at: string; retired_at: string | null }[] = [];
      try {
        const spaces = [...new Set(fresh.map((r) => r.activity_space_id).filter((x): x is string => !!x))];
        if (spaces.length) {
          const { data, error } = await admin.from("planning_constraints")
            .select("id, scope, target_definition_id, target_strategy_id, activated_at, retired_at")
            .in("activity_space_id", spaces);
          if (!error) constraintRows = (data ?? []) as typeof constraintRows;
        }
      } catch { /* evidence is additive; its absence is honest */ }
      const stamped = rows.map((row, i) => ({
        ...row,
        evidence: {
          constraint_ids: activeConstraintIdsAt(
            constraintRows.map((c) => ({
              id: c.id, scope: c.scope,
              targetDefinitionId: c.target_definition_id, targetStrategyId: c.target_strategy_id,
              activatedAt: c.activated_at, retiredAt: c.retired_at,
            })),
            {
              definitionId: row.definition_id,
              strategyId: row.strategy_id,
              createdAt: fresh[i].created_at ?? row.finished_at,
            },
          ),
        },
      }));
      const { data: wrote, error } = await admin.from("run_outcomes")
        .upsert(stamped, { onConflict: "run_id", ignoreDuplicates: true }).select("run_id");
      if (error) console.error("outcomes: settle insert failed", error.message);
      else inserted = (wrote ?? []).length;
    }
  }

  // ── 2. Signal pass ──────────────────────────────────────────────────
  const horizon = new Date(now.getTime() - SIGNAL_HORIZON_DAYS * 86_400_000).toISOString();
  const { data: openRows } = await admin.from("run_outcomes")
    .select("id, run_id, element_id, finished_at")
    .eq("human_signal", "none").gt("finished_at", horizon)
    .order("finished_at", { ascending: true }).limit(SIGNALS_PER_TICK);
  const open = (openRows ?? []) as { id: string; run_id: string; element_id: string | null; finished_at: string }[];
  if (open.length) {
    const runIds = open.map((o) => o.run_id);
    const { data: runRows } = await admin.from("agent_runs")
      .select("id, element_id, finished_at, proposed_readings").in("id", runIds);
    const runsById = new Map(((runRows ?? []) as { id: string; element_id: string | null; finished_at: string; proposed_readings: unknown }[])
      .map((r) => [r.id, r]));
    const { data: actionRows } = await admin.from("agent_actions")
      .select("run_id, status, decision_source, decided_by, decided_at, integration_id, tool")
      .in("run_id", runIds);
    const actionsByRun = new Map<string, OutcomeActionRow[]>();
    for (const a of (actionRows ?? []) as OutcomeActionRow[]) {
      const list = actionsByRun.get(a.run_id) ?? [];
      list.push(a);
      actionsByRun.set(a.run_id, list);
    }
    const elementIds = [...new Set(open.map((o) => o.element_id).filter((x): x is string => !!x))];
    const activitiesByElement = new Map<string, ElementActivityRow[]>();
    const finishedByElement = new Map<string, { id: string; finished_at: string }[]>();
    if (elementIds.length) {
      const earliest = open.reduce((m, o) => (o.finished_at < m ? o.finished_at : m), open[0].finished_at);
      const { data: acts } = await admin.from("element_activity")
        .select("element_id, detail, actor_id, created_at")
        .eq("kind", "status").in("element_id", elementIds).gt("created_at", earliest)
        .order("created_at", { ascending: true });
      for (const a of (acts ?? []) as ElementActivityRow[]) {
        const list = activitiesByElement.get(a.element_id) ?? [];
        list.push(a);
        activitiesByElement.set(a.element_id, list);
      }
      const { data: fin } = await admin.from("agent_runs")
        .select("id, element_id, finished_at").in("element_id", elementIds).not("finished_at", "is", null);
      for (const r of (fin ?? []) as { id: string; element_id: string; finished_at: string }[]) {
        const list = finishedByElement.get(r.element_id) ?? [];
        list.push({ id: r.id, finished_at: r.finished_at });
        finishedByElement.set(r.element_id, list);
      }
    }
    const { data: drafts } = await admin.from("promotion_drafts").select("source_run_id, events").in("source_run_id", runIds);
    const rollbacksByRun = new Map<string, { at: string; by: string | null }[]>();
    for (const d of (drafts ?? []) as { source_run_id: string; events: unknown }[]) {
      if (!Array.isArray(d.events)) continue;
      for (const e of d.events as { kind?: unknown; at?: unknown; by?: unknown }[]) {
        if (e?.kind !== "rolled_back" || typeof e.at !== "string") continue;
        const list = rollbacksByRun.get(d.source_run_id) ?? [];
        list.push({ at: e.at, by: typeof e.by === "string" ? e.by : null });
        rollbacksByRun.set(d.source_run_id, list);
      }
    }

    for (const o of open) {
      const run = runsById.get(o.run_id);
      if (!run) continue;
      const readings = parseProposedReadings(run.proposed_readings) ?? [];
      const signal = pickSignal(signalCandidatesOf({
        run: { id: o.run_id, element_id: run.element_id, finished_at: run.finished_at },
        actions: actionsByRun.get(o.run_id) ?? [],
        readings,
        activities: run.element_id ? (activitiesByElement.get(run.element_id) ?? []) : [],
        elementFinishedRuns: run.element_id ? (finishedByElement.get(run.element_id) ?? []) : [],
        rollbacks: rollbacksByRun.get(o.run_id) ?? [],
      }));
      if (!signal) continue;
      // The signal lands with the readings counts as they now stand —
      // an acceptance is recorded with the very applications that prove
      // it. The claim (still 'none') makes two ticks fill it once.
      const { data: filled } = await admin.from("run_outcomes").update({
        human_signal: signal.signal, signal_source: signal.source, signal_at: signal.at, signal_by: signal.by,
        ...readingsCountsOf(readings),
        updated_at: now.toISOString(),
      }).eq("id", o.id).eq("human_signal", "none").select("id").maybeSingle();
      if (filled) signalled += 1;
    }
  }

  // ── 3. Rollup pass ──────────────────────────────────────────────────
  // Refreshed when this pass changed the data, or when a window has
  // slid since the stored rows were written — and only then, so a
  // quiet tick stays $0.
  const staleBefore = windowStartOf(now, 28);
  const { data: stale } = await admin.from("outcome_rollups").select("id").lt("window_start", staleBefore).limit(1);
  if (inserted > 0 || signalled > 0 || (stale ?? []).length > 0) {
    const since = new Date(now.getTime() - 28 * 86_400_000).toISOString();
    const { data: windowOutcomes } = await admin.from("run_outcomes")
      .select("run_id, element_id, strategy_id, activity_space_id, driver, definition_id, definition_version, outcome, verdict_result, verdict_reason, revisions, cost_usd, approvals_asked, approvals_approved, approvals_rejected, approvals_policy, readings_applied, readings_held, finished_at, human_signal")
      .gte("finished_at", since).order("finished_at", { ascending: true }).limit(5000);
    const outs = (windowOutcomes ?? []) as unknown as (OutcomeInsert & { human_signal: string })[];
    const { data: runRows } = outs.length
      ? await admin.from("agent_runs").select("id, status").in("id", outs.map((o) => o.run_id))
      : { data: [] };
    const runStatus = new Map(((runRows ?? []) as { id: string; status: string }[]).map((r) => [r.id, r.status]));
    let windowActions: OutcomeActionRow[] = [];
    if (outs.length) {
      const ids = outs.map((o) => o.run_id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data: chunk } = await admin.from("agent_actions")
          .select("run_id, status, decision_source, decided_by, decided_at, integration_id, tool")
          .in("run_id", ids.slice(i, i + 200));
        windowActions = windowActions.concat((chunk ?? []) as OutcomeActionRow[]);
      }
    }
    const rows = rollupRowsOf({ outcomes: outs, runStatus, actions: windowActions, now });
    if (rows.length) {
      const { error } = await admin.from("outcome_rollups")
        .upsert(rows.map((r) => ({ ...r, updated_at: now.toISOString() })), { onConflict: "scope_kind,scope_id,window_start,window_days" });
      if (error) console.error("outcomes: rollup upsert failed", error.message);
      else rollups = rows.length;
    }
    await admin.from("outcome_rollups").delete().lt("window_start", staleBefore);
  }

  return { inserted, signalled, rollups };
}
