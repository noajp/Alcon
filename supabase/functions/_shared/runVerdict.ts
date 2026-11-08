// A run's verdict: the verifier's judgement of the finish that stood, as a
// sealed record on the run instead of a line of step text. Pure: run-agent
// supplies what the verifier did; this file decides what the record says
// and reads records back. The agent's own finish is a claim (the run's
// summary/result); only the verifier's record is a judgement, and the agent
// itself never appears as a verdict's source. Written once at a terminal
// finish and never updated — the web mirror of parseRunVerdict lives in
// web/src/Function/audit/auditModel.ts and is pinned to this one by tests.
//
// v2 adds the finish's claim accounting, counted by code (finishClaims.ts):
// how many claims the standing finish made, how many carried a source, how
// many were stale, and the mechanical findings as their own class — kept
// apart from the verifier's semantic gaps, because B5's calibration pairs
// each class with human outcomes separately. v1 records (written before
// claims existed) stay readable forever; a v1 record simply has no
// accounting, and parseRunVerdict says so by their absence.

import type { ClaimCheck } from "./finishClaims.ts";

export type RunVerdictResult = "pass" | "fail" | "unchecked";

export type RunVerdictReason =
  | "revisions-exhausted"    // last check failed; the finish stood anyway
  | "verify-unavailable"     // the check errored or answered unreadably
  | "outcome-not-completed"  // partial / blocked finishes are not checked
  | "external-model";        // runs on an external model have no verifier

export interface RunVerdict {
  v: 1 | 2;
  result: RunVerdictResult;
  /** Who judged. 'verifier' = the separate check; 'none' = nobody did. */
  source: "verifier" | "none";
  /** The model that ran the check (the verifier runs on the run's model). */
  model: string | null;
  /** What the verifier found missing (≤5, its own words). Empty on pass. */
  gaps: string[];
  /** Times the loop sent a finish back before the one that stood. */
  revisions: number;
  /** When the last check ran; null when no check ran. */
  checkedAt: string | null;
  /** The finish outcome this record judges. */
  outcome: "completed" | "partial" | "blocked";
  /** Why the record is not a checked pass; null on pass. */
  reason: RunVerdictReason | null;
  /** What the check read, so a person can re-walk it. */
  evidence: {
    /** idx of the run's 検証 step (agent_run_steps.idx), null when none. */
    verifyStepIdx: number | null;
    /** The artifacts the verifier was shown. */
    artifactIds: string[];
  };
  /**
   * v2 only: the standing finish's claim accounting, counted by code —
   * claims made, claims carrying a source, claims stale against the
   * freshness bounds. Absent on v1 records.
   */
  claims?: { total: number; sourced: number; stale: number };
  /**
   * v2 only: the mechanical findings on the standing finish (≤5), kept as
   * their own class, distinct from the verifier's semantic `gaps` above.
   * Absent on v1 records.
   */
  claimGaps?: string[];
}

export interface VerdictInputs {
  /** The last verdict the verifier returned for this run, and when. */
  lastCheck: { pass: boolean; gaps: string[]; model: string; checkedAt: string; verifyStepIdx: number | null; artifactIds: string[] } | null;
  /** The verifier was attempted for the standing finish but returned nothing. */
  checkAttempted: boolean;
  revisions: number;
  finish: { outcome: "completed" | "partial" | "blocked" };
  external: boolean;
  /**
   * The standing finish's claim accounting, computed by code from its
   * payload (checkFinishClaims) — recorded whatever the verifier did,
   * because the counts describe the finish, not the check.
   */
  claimCheck: ClaimCheck;
}

const claimFields = (input: VerdictInputs): Pick<RunVerdict, "claims" | "claimGaps"> => ({
  claims: { ...input.claimCheck.counts },
  claimGaps: input.claimCheck.gaps.slice(0, 5),
});

const noCheck = (input: VerdictInputs, reason: RunVerdictReason): RunVerdict => ({
  v: 2,
  result: "unchecked",
  source: "none",
  model: null,
  gaps: [],
  revisions: input.revisions,
  checkedAt: null,
  outcome: input.finish.outcome,
  reason,
  evidence: { verifyStepIdx: null, artifactIds: [] },
  ...claimFields(input),
});

/**
 * The record for the finish that stood. A failing last check is a
 * first-class 'fail' even though the run completed: the loop lets the
 * finish stand once revisions run out, and the record surfaces that rather
 * than laundering it into a pass. There is no confidence number — the
 * verifier emits none, and inventing one would be false precision.
 */
export function buildRunVerdict(input: VerdictInputs): RunVerdict {
  if (input.finish.outcome !== "completed") return noCheck(input, "outcome-not-completed");
  if (input.external) return noCheck(input, "external-model");
  const check = input.lastCheck;
  if (check) {
    return {
      v: 2,
      result: check.pass ? "pass" : "fail",
      source: "verifier",
      model: check.model,
      gaps: check.pass ? [] : check.gaps.slice(0, 5),
      revisions: input.revisions,
      checkedAt: check.checkedAt,
      outcome: input.finish.outcome,
      reason: check.pass ? null : "revisions-exhausted",
      evidence: { verifyStepIdx: check.verifyStepIdx, artifactIds: [...check.artifactIds] },
      ...claimFields(input),
    };
  }
  // Attempted or not, from the record's side the fact is the same: the
  // verifier could not answer, so the finish was not checked.
  return noCheck(input, "verify-unavailable");
}

const RESULTS: readonly string[] = ["pass", "fail", "unchecked"];
const SOURCES: readonly string[] = ["verifier", "none"];
const OUTCOMES: readonly string[] = ["completed", "partial", "blocked"];
const REASONS: readonly string[] = ["revisions-exhausted", "verify-unavailable", "outcome-not-completed", "external-model"];

/** Strict narrowing of the jsonb: a record that is not exactly its
 *  version's shape is not a verdict (null), never a partially-read one.
 *  v1 records — written before claims existed — are read as they were:
 *  no claim accounting, and none is invented for them. */
export function parseRunVerdict(raw: unknown): RunVerdict | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 && r.v !== 2) return null;
  if (typeof r.result !== "string" || !RESULTS.includes(r.result)) return null;
  if (typeof r.source !== "string" || !SOURCES.includes(r.source)) return null;
  if (!(r.model === null || typeof r.model === "string")) return null;
  if (!Array.isArray(r.gaps) || !r.gaps.every((g) => typeof g === "string")) return null;
  if (typeof r.revisions !== "number" || !Number.isInteger(r.revisions) || r.revisions < 0) return null;
  if (!(r.checkedAt === null || typeof r.checkedAt === "string")) return null;
  if (typeof r.outcome !== "string" || !OUTCOMES.includes(r.outcome)) return null;
  if (!(r.reason === null || (typeof r.reason === "string" && REASONS.includes(r.reason)))) return null;
  const evidence = r.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const e = evidence as Record<string, unknown>;
  if (!(e.verifyStepIdx === null || (typeof e.verifyStepIdx === "number" && Number.isInteger(e.verifyStepIdx)))) return null;
  if (!Array.isArray(e.artifactIds) || !e.artifactIds.every((id) => typeof id === "string")) return null;
  const base: RunVerdict = {
    v: r.v as 1 | 2,
    result: r.result as RunVerdictResult,
    source: r.source as RunVerdict["source"],
    model: r.model as string | null,
    gaps: [...(r.gaps as string[])],
    revisions: r.revisions as number,
    checkedAt: r.checkedAt as string | null,
    outcome: r.outcome as RunVerdict["outcome"],
    reason: r.reason as RunVerdictReason | null,
    evidence: { verifyStepIdx: e.verifyStepIdx as number | null, artifactIds: [...(e.artifactIds as string[])] },
  };
  if (r.v === 1) return base;
  // v2 must carry its accounting exactly: counts are non-negative integers
  // that cannot exceed the total, and the findings are strings.
  const claims = r.claims;
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  const c = claims as Record<string, unknown>;
  const count = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
  if (!count(c.total) || !count(c.sourced) || !count(c.stale)) return null;
  if ((c.sourced as number) > (c.total as number) || (c.stale as number) > (c.total as number)) return null;
  if (!Array.isArray(r.claimGaps) || !r.claimGaps.every((g) => typeof g === "string")) return null;
  return {
    ...base,
    claims: { total: c.total as number, sourced: c.sourced as number, stale: c.stale as number },
    claimGaps: [...(r.claimGaps as string[])],
  };
}
