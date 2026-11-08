// Verifier calibration (B5): grade the grader. B4's outcome records
// pair each run's sealed verdict with the human signal that eventually
// spoke about it; this file pairs them per definition over a trailing
// window and asks the only question calibration can ask — where the
// verifier and the human SYSTEMATICALLY disagree on a definition, is
// the definition the suspect? Where the answer is yes, a revision
// candidate opens in definition_revision_candidates: a queue a person
// works, never an edit anything makes. A verdict that changes nothing
// is a report; this makes verdicts causal without letting the measured
// system touch what it is measured on.
//
// The discipline mirrors the collector's: pure builders first (the
// pairing, the counts, the candidate rule, the write plan, the
// heartbeat signals), a thin database shell at the bottom, and no
// model anywhere in the measurement — the evaluator is code on the
// automations tick, beside the collector whose rows it reads.
//
// Pairs are counted only where BOTH sides spoke:
//   - the verdict was CHECKED — pass or fail. An 'unchecked' finish
//     was never judged by the verifier; a definition whose finishes
//     are always accepted unchecked accrues no pairs, by construction.
//   - a human signal exists — accepted, rejected or rework. 'none'
//     is absence, not a judgement, and never pairs.
// Per connector×command there is deliberately NO calibration: a run's
// verdict judges the run's whole work, not one command among many,
// so attributing it to a single command would fabricate pairs the
// records do not contain. The definition is the unit the data
// honestly supports.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { windowStartOf } from "./outcomeCollector.ts";
import type { HeartbeatSignal } from "./heartbeatSnapshot.ts";

/** The calibration policy — the program's numbers, in one named
 *  place (design §3 B5, owner-adopted defaults). They are policy,
 *  not engineering: below the pair floor nothing is concluded, and
 *  that silence is the correct behavior while signals are sparse —
 *  concluding from three samples is how a system learns superstitions. */
export const CALIBRATION_POLICY = {
  /** The trailing window pairs are counted over. */
  windowDays: 28,
  /** Pairs a definition needs before any direction may be judged. */
  minPairs: 10,
  /** One direction's error rate at which the definition is suspect. */
  errorRate: 0.3,
  /** Sample outcome ids kept on a candidate, per direction. */
  sampleLimit: 20,
  /** Outcome rows one evaluation reads at most (the collector's scale). */
  readLimit: 5000,
  /** Open candidates one evaluation reads at most. */
  candidateReadLimit: 500,
} as const;

// ── The pairing ───────────────────────────────────────────────────────

export interface CalibrationOutcomeFact {
  /** run_outcomes.id — the pair's own row, named on candidates as evidence. */
  id: string;
  activitySpaceId: string | null;
  definitionId: string | null;
  verdictResult: "pass" | "fail" | "unchecked" | null;
  humanSignal: "accepted" | "rejected" | "rework" | "none";
  finishedAt: string;
}

export type PairClass = "agree_pass" | "agree_fail" | "false_pass" | "false_fail";

/** Pure. How one outcome pairs, or null when it cannot pair at all:
 *  the verdict was never checked, or no human ever spoke. A human
 *  rejection and a review send-back (rework) are the same judgement
 *  from calibration's side — the work did not stand. */
export function pairClassOf(
  verdictResult: CalibrationOutcomeFact["verdictResult"],
  humanSignal: CalibrationOutcomeFact["humanSignal"],
): PairClass | null {
  if (verdictResult !== "pass" && verdictResult !== "fail") return null;
  if (humanSignal === "none") return null;
  if (verdictResult === "pass") return humanSignal === "accepted" ? "agree_pass" : "false_pass";
  return humanSignal === "accepted" ? "false_fail" : "agree_fail";
}

export interface CalibrationCounts {
  activitySpaceId: string;
  definitionId: string;
  agreePass: number;
  agreeFail: number;
  falsePass: number;
  falseFail: number;
  /** Pairs counted (both sides spoke). Unpaired outcomes never enter. */
  pairs: number;
  /** The disagreeing pairs' outcome ids, newest first, capped —
   *  the evidence a candidate of that direction stands on. */
  falsePassIds: string[];
  falseFailIds: string[];
}

/** Pure. Every definition's pair counts over the given outcome facts.
 *  Deterministic in the facts alone: facts are ordered newest first
 *  before counting, and groups come back in a stable order. */
export function calibrationCountsOf(facts: readonly CalibrationOutcomeFact[]): CalibrationCounts[] {
  const sorted = [...facts].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || a.id.localeCompare(b.id));
  const groups = new Map<string, CalibrationCounts>();
  for (const f of sorted) {
    if (!f.activitySpaceId || !f.definitionId) continue;
    const cls = pairClassOf(f.verdictResult, f.humanSignal);
    if (!cls) continue;
    const key = `${f.activitySpaceId}:${f.definitionId}`;
    const g = groups.get(key) ?? {
      activitySpaceId: f.activitySpaceId, definitionId: f.definitionId,
      agreePass: 0, agreeFail: 0, falsePass: 0, falseFail: 0, pairs: 0,
      falsePassIds: [], falseFailIds: [],
    };
    g.pairs += 1;
    if (cls === "agree_pass") g.agreePass += 1;
    else if (cls === "agree_fail") g.agreeFail += 1;
    else if (cls === "false_pass") { g.falsePass += 1; if (g.falsePassIds.length < CALIBRATION_POLICY.sampleLimit) g.falsePassIds.push(f.id); }
    else { g.falseFail += 1; if (g.falseFailIds.length < CALIBRATION_POLICY.sampleLimit) g.falseFailIds.push(f.id); }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.definitionId.localeCompare(b.definitionId));
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Pure. One direction's error rate over the pairs (0 with no pairs). */
export function errorRateOf(counts: Pick<CalibrationCounts, "falsePass" | "falseFail" | "pairs">, direction: "false_pass" | "false_fail"): number {
  if (!counts.pairs) return 0;
  return round4((direction === "false_pass" ? counts.falsePass : counts.falseFail) / counts.pairs);
}

// ── The candidate rule ────────────────────────────────────────────────

export type CalibrationReason = "false_pass_heavy" | "false_fail_heavy";

export interface CalibrationCandidateDraft {
  reason: CalibrationReason;
  /** The suspect direction's error rate over the pairs. */
  rate: number;
  pairs: number;
  /** The suspect direction's disagreeing pairs, as evidence. */
  sampleOutcomeIds: string[];
}

/**
 * Pure. The candidate a definition's counts open, or null. The rule
 * is the design's: at least minPairs pairs AND one direction's error
 * rate at or over the threshold. Both directions over → the larger
 * rate names the bias; a tie names false-pass-heavy, because a
 * verifier that passes work people send back is the direction that
 * lets bad work stand in the world.
 */
export function candidateDraftOf(counts: CalibrationCounts): CalibrationCandidateDraft | null {
  if (counts.pairs < CALIBRATION_POLICY.minPairs) return null;
  const fp = errorRateOf(counts, "false_pass");
  const ff = errorRateOf(counts, "false_fail");
  const fpOver = fp >= CALIBRATION_POLICY.errorRate;
  const ffOver = ff >= CALIBRATION_POLICY.errorRate;
  if (!fpOver && !ffOver) return null;
  if (fpOver && (!ffOver || fp >= ff)) {
    return { reason: "false_pass_heavy", rate: fp, pairs: counts.pairs, sampleOutcomeIds: counts.falsePassIds };
  }
  return { reason: "false_fail_heavy", rate: ff, pairs: counts.pairs, sampleOutcomeIds: counts.falseFailIds };
}

// ── The write plan ────────────────────────────────────────────────────

export interface OpenCandidateRow {
  id: string;
  definitionId: string;
  activitySpaceId: string;
  reason: string;
  rate: number;
  pairs: number;
  sampleOutcomeIds: string[];
  createdAt: string;
}

export interface CandidateInsert {
  definition_id: string;
  activity_space_id: string;
  reason: CalibrationReason;
  rate: number;
  pairs: number;
  sample_outcome_ids: string[];
}

export interface CandidateUpdate {
  id: string;
  reason: string;
  rate: number;
  pairs: number;
  sample_outcome_ids: string[];
}

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Pure. What one evaluation writes to the queue, given the open
 * candidates as they stand and the window's fresh counts:
 *   - a group over the rule with no open candidate → an insert;
 *   - an open candidate whose group still has pairs → a refresh to
 *     the current numbers (reason follows the fresh draft when one
 *     stands; below the rule the stored reason stands and its own
 *     direction's rate is what refreshes — the claim stays the one
 *     that was opened, wearing today's numbers);
 *   - an open candidate whose group has no pairs left in the window
 *     → untouched: its evidence slid out of the window, and the row
 *     remains the record of why it opened. A person resolves it.
 *   - a gap_cluster candidate is never B5's to refresh — it is not
 *     opened by this evaluator, and its numbers are not these counts.
 * An update identical to the stored row is not planned, so a quiet
 * evaluation writes nothing.
 */
export function candidateWritesOf(
  open: readonly OpenCandidateRow[],
  counts: readonly CalibrationCounts[],
): { inserts: CandidateInsert[]; updates: CandidateUpdate[] } {
  const inserts: CandidateInsert[] = [];
  const updates: CandidateUpdate[] = [];
  const openByDefinition = new Map(open.map((c) => [c.definitionId, c]));

  for (const g of counts) {
    const draft = candidateDraftOf(g);
    const existing = openByDefinition.get(g.definitionId);
    if (!existing) {
      if (draft) {
        inserts.push({
          definition_id: g.definitionId, activity_space_id: g.activitySpaceId,
          reason: draft.reason, rate: draft.rate, pairs: draft.pairs, sample_outcome_ids: draft.sampleOutcomeIds,
        });
      }
      continue;
    }
    if (existing.reason === "gap_cluster") continue;
    const next: CandidateUpdate = draft
      ? { id: existing.id, reason: draft.reason, rate: draft.rate, pairs: draft.pairs, sample_outcome_ids: draft.sampleOutcomeIds }
      : {
          id: existing.id, reason: existing.reason, pairs: g.pairs,
          rate: errorRateOf(g, existing.reason === "false_pass_heavy" ? "false_pass" : "false_fail"),
          sample_outcome_ids: existing.reason === "false_pass_heavy" ? g.falsePassIds : g.falseFailIds,
        };
    if (next.reason !== existing.reason || next.rate !== existing.rate || next.pairs !== existing.pairs
      || !sameIds(next.sample_outcome_ids, existing.sampleOutcomeIds)) {
      updates.push(next);
    }
  }
  // Open candidates whose group fell out of the counts entirely are
  // deliberately absent here: no pairs in the window, no refresh.
  return { inserts, updates };
}

// ── The heartbeat surface ─────────────────────────────────────────────

export interface CalibrationCandidateFact {
  id: string;
  definitionId: string;
  reason: string;
  rate: number;
  pairs: number;
  createdAt: string;
}

const CALIBRATION_PLACE = "Settings › AI › Harnesses で確認できます";

/**
 * Pure. The wake's calibration signals from the Space's OPEN
 * candidates: one per candidate, waiting since the day it opened,
 * fingerprinted by the candidate's own id (`calibration:<id>`) — so
 * a candidate is told once (plus the snapshot's one escalation),
 * and a candidate opened after a dismissal, being a new row with a
 * new id, is a new wait that may be told again. Like every heartbeat
 * signal these are candidates for a telling, never an action: the
 * heartbeat cannot revise, dismiss or address anything.
 */
export function calibrationCandidateSignals(
  candidates: readonly CalibrationCandidateFact[],
  definitionName: ReadonlyMap<string, string>,
): HeartbeatSignal[] {
  const out: HeartbeatSignal[] = [];
  for (const c of candidates) {
    const name = definitionName.get(c.definitionId) ?? "定義";
    const errors = Math.round(c.rate * c.pairs);
    const pct = Math.round(c.rate * 100);
    const label = c.reason === "false_pass_heavy"
      ? `定義「${name}」の検証は甘めです（人が差し戻した合格が ${errors} 件、全 ${c.pairs} 件中 ${pct}%）`
      : c.reason === "false_fail_heavy"
        ? `定義「${name}」の検証は厳しめです（人が受け入れた不合格が ${errors} 件、全 ${c.pairs} 件中 ${pct}%）`
        : `定義「${name}」に見直しの候補があります`;
    out.push({ kind: "calibration_candidate", id: c.id, since: c.createdAt, label: label.slice(0, 200), place: CALIBRATION_PLACE });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since));
}

// ── The evaluator (database shell) ────────────────────────────────────

interface OutcomeFactRow {
  id: string;
  activity_space_id: string | null;
  definition_id: string | null;
  verdict_result: string | null;
  human_signal: string;
  finished_at: string;
}

interface CandidateRow {
  id: string;
  definition_id: string;
  activity_space_id: string;
  reason: string;
  rate: number | string;
  pairs: number;
  sample_outcome_ids: string[] | null;
  created_at: string;
}

/**
 * One evaluation of the calibration, on the automations tick beside
 * the collector. Refresh order matters: the rollup is recomputed
 * from the window's outcome rows first, then the queue is planned
 * from the same counts and applied — so the drill-down numbers and
 * the candidate a heartbeat may raise never disagree about the
 * window they were read from. Idempotent: a second evaluation over
 * the same world refreshes the same rollup rows and plans no
 * candidate writes.
 */
export async function evaluateCalibration(
  admin: SupabaseClient,
  now: Date,
): Promise<{ calibrationRows: number; opened: number; refreshed: number }> {
  let calibrationRows = 0, opened = 0, refreshed = 0;
  const windowStart = windowStartOf(now, CALIBRATION_POLICY.windowDays);

  // The window is the collector's bucket exactly ([windowStart,
  // windowStart + windowDays)), so the calibration row and B4's
  // rollups never disagree about which finishes a window holds.
  const { data: factRows } = await admin.from("run_outcomes")
    .select("id, activity_space_id, definition_id, verdict_result, human_signal, finished_at")
    .not("definition_id", "is", null)
    .in("verdict_result", ["pass", "fail"])
    .neq("human_signal", "none")
    .gte("finished_at", windowStart)
    .order("finished_at", { ascending: false })
    .limit(CALIBRATION_POLICY.readLimit);
  const facts: CalibrationOutcomeFact[] = ((factRows ?? []) as OutcomeFactRow[]).map((r) => ({
    id: r.id,
    activitySpaceId: r.activity_space_id,
    definitionId: r.definition_id,
    verdictResult: (r.verdict_result as CalibrationOutcomeFact["verdictResult"]) ?? null,
    humanSignal: r.human_signal as CalibrationOutcomeFact["humanSignal"],
    finishedAt: r.finished_at,
  }));
  const counts = calibrationCountsOf(facts);

  // ── The rollup refresh ────────────────────────────────────────────
  // Written when this window has counts, or when a stale bucket is
  // still standing — and only then, so a quiet tick stays $0 like
  // the collector's.
  const { data: stale } = await admin.from("verifier_calibration").select("id").lt("window_start", windowStart).limit(1);
  if (counts.length || (stale ?? []).length) {
    if (counts.length) {
      const rows = counts.map((g) => ({
        activity_space_id: g.activitySpaceId,
        definition_id: g.definitionId,
        window_start: windowStart,
        window_days: CALIBRATION_POLICY.windowDays,
        agree_pass: g.agreePass, agree_fail: g.agreeFail,
        false_pass: g.falsePass, false_fail: g.falseFail, pairs: g.pairs,
        updated_at: now.toISOString(),
      }));
      const { error } = await admin.from("verifier_calibration")
        .upsert(rows, { onConflict: "activity_space_id,definition_id,window_start,window_days" });
      if (error) console.error("calibration: rollup upsert failed", error.message);
      else calibrationRows = rows.length;
    }
    await admin.from("verifier_calibration").delete().lt("window_start", windowStart);
  }

  // ── The queue ─────────────────────────────────────────────────────
  const { data: openRows } = await admin.from("definition_revision_candidates")
    .select("id, definition_id, activity_space_id, reason, rate, pairs, sample_outcome_ids, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: true })
    .limit(CALIBRATION_POLICY.candidateReadLimit);
  const open: OpenCandidateRow[] = ((openRows ?? []) as CandidateRow[]).map((r) => ({
    id: r.id, definitionId: r.definition_id, activitySpaceId: r.activity_space_id,
    reason: r.reason, rate: Number(r.rate), pairs: r.pairs,
    sampleOutcomeIds: r.sample_outcome_ids ?? [], createdAt: r.created_at,
  }));
  const plan = candidateWritesOf(open, counts);
  for (const ins of plan.inserts) {
    const { error } = await admin.from("definition_revision_candidates").insert(ins);
    // A racing tick opened it first (the partial unique index holds
    // the line); that is a refresh's outcome, not an error.
    if (error && error.code !== "23505") console.error("calibration: candidate insert failed", error.message);
    else if (!error) opened += 1;
  }
  for (const upd of plan.updates) {
    const { data: moved } = await admin.from("definition_revision_candidates")
      .update({ reason: upd.reason, rate: upd.rate, pairs: upd.pairs, sample_outcome_ids: upd.sample_outcome_ids, updated_at: now.toISOString() })
      .eq("id", upd.id).eq("status", "open").select("id").maybeSingle();
    if (moved) refreshed += 1;
  }

  return { calibrationRows, opened, refreshed };
}
