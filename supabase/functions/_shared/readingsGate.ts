// The gate a finish's proposed measure readings must pass before one of
// them may move a Strategy's declared success measure. Pure: run-agent
// supplies the finish's proposals, the measures the run's Element actually
// serves, and the run's verdict; this file decides what each proposal is
// and whether any of them may land.
//
// A reading is a consequential write, so the agent's own say-so is never
// enough: the finish that carried the number must hold a checked pass from
// the verifier. Application then follows the review flow the product
// already has — at finish under a Strategy set to 'auto', or when a person
// accepts the work (closes the Element) under manual review. Every other
// proposal stays on the run with the reason it did not land. The web
// mirror of the record shape lives in web/src/Function/audit/auditModel.ts
// and is pinned to this one by tests.

import type { RunVerdict } from "./runVerdict.ts";

/** A measure of a Strategy the run's Element serves — the only measures a
 *  finish of that run may report on. Binding is by construction: proposals
 *  are validated against this set, never trusted by id alone. */
export interface BoundMeasure { id: string; title: string; strategyId: string }

export type ProposedReadingHeldReason =
  | "awaiting-acceptance"   // checked pass, manual Strategy: lands when the work is accepted
  | "verdict-not-pass"      // fail or unchecked verdict: never lands from this run
  | "not-bound"             // measure is not one this run serves (dropped at validation; kept for the record)
  | "write-failed";         // the intents update failed; see the run's step

/** One reading a finish proposed, and whether it landed. Written onto the
 *  run at finish; only the applied fields change afterwards (at acceptance). */
export interface ProposedReading {
  measureId: string;
  value: number;
  applied: boolean;
  appliedAt: string | null;
  /** auth user whose client wrote the intents update (the run's starter at
   *  finish; the person who closed the Element at acceptance). */
  appliedBy: string | null;
  /** Why it did not land, when it never will or has not yet. Null once applied. */
  heldReason: ProposedReadingHeldReason | null;
}

const MAX_READINGS = 10;

/**
 * What a finish proposed, as recordable proposals: duplicates collapse
 * (last wins) and the list caps at ten. A measure this run does not serve
 * is kept with its reason — the record should show the agent tried to
 * report a number it had no right to report. A value that is not a finite
 * number is rejected outright: it cannot be represented in the record,
 * and a reading is a measured number or it is nothing (the same rule
 * validateMeasurePatch keeps for hand-entered readings).
 */
export function validateProposals(
  raw: readonly { measureId: string; value: number }[] | undefined,
  bound: readonly BoundMeasure[],
): ProposedReading[] {
  if (!raw) return [];
  const byId = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { measureId, value } = entry as { measureId?: unknown; value?: unknown };
    if (typeof measureId !== "string" || !measureId) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    byId.set(measureId, value);
  }
  const boundIds = new Set(bound.map((m) => m.id));
  return [...byId.entries()].slice(0, MAX_READINGS).map(([measureId, value]) => ({
    measureId,
    value,
    applied: false,
    appliedAt: null,
    appliedBy: null,
    heldReason: boundIds.has(measureId) ? null : "not-bound",
  }));
}

/**
 * Whether a run's held proposals may land at this moment. Only a checked
 * pass ever lands: a fail-standing or unchecked run's numbers are refused
 * even if a person accepts the work, because a measurement's correctness
 * is exactly what a reader cannot eyeball — and what the verifier is for.
 */
export function readingsDecision(input: {
  verdict: RunVerdict | null;
  delegation: "auto" | "manual";
  elementClosed: boolean;      // acceptance point only
}): "apply" | "hold" | "reject" {
  if (!input.verdict || input.verdict.result !== "pass") return "reject";
  if (input.delegation === "auto" || input.elementClosed) return "apply";
  return "hold";
}

const HELD_REASONS: readonly string[] = ["awaiting-acceptance", "verdict-not-pass", "not-bound", "write-failed"];

/** Strict narrowing of the proposed_readings jsonb (the advance handler
 *  reads it back to apply what acceptance releases); one malformed entry
 *  makes the whole record unreadable rather than silently partial. */
export function parseProposedReadings(raw: unknown): ProposedReading[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ProposedReading[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const e = entry as Record<string, unknown>;
    if (typeof e.measureId !== "string" || !e.measureId) return null;
    if (typeof e.value !== "number" || !Number.isFinite(e.value)) return null;
    if (typeof e.applied !== "boolean") return null;
    if (!(e.appliedAt === null || typeof e.appliedAt === "string")) return null;
    if (!(e.appliedBy === null || typeof e.appliedBy === "string")) return null;
    if (!(e.heldReason === null || (typeof e.heldReason === "string" && HELD_REASONS.includes(e.heldReason)))) return null;
    out.push({
      measureId: e.measureId, value: e.value, applied: e.applied,
      appliedAt: e.appliedAt as string | null, appliedBy: e.appliedBy as string | null,
      heldReason: e.heldReason as ProposedReadingHeldReason | null,
    });
  }
  return out;
}

/** Pure. The one line a finish's step gains for its readings, by class. */
export function readingsSummaryLine(proposals: readonly ProposedReading[]): string {
  const count = (pick: (p: ProposedReading) => boolean) => proposals.filter(pick).length;
  const parts: string[] = [];
  const recorded = count((p) => p.applied);
  if (recorded) parts.push(`${recorded} 件を記録`);
  const waiting = count((p) => !p.applied && p.heldReason === "awaiting-acceptance");
  if (waiting) parts.push(`${waiting} 件はレビュー待ち`);
  const notBound = count((p) => p.heldReason === "not-bound");
  if (notBound) parts.push(`${notBound} 件は対象外のため不記録`);
  const notPassed = count((p) => p.heldReason === "verdict-not-pass");
  if (notPassed) parts.push(`${notPassed} 件は検証が通らなかったため不記録`);
  const failed = count((p) => p.heldReason === "write-failed");
  if (failed) parts.push(`${failed} 件は記録に失敗`);
  return parts.length ? `成功条件の報告: ${parts.join("、")}` : "";
}
