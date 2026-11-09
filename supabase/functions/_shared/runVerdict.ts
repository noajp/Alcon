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
//
// B2 adds the run's verify accounting to v2, likewise counted by code
// (verifyReads.ts): how many declared writes were read back, how many
// matched, mismatched, or could not be checked. It is optional within
// v2 — absent when no verify-declared write ran, which is most runs —
// because the accounting describes the run's writes, not its finish.
//
// B3 adds two more optional v2 fields, on the same terms. The
// corrections a run's finishes were sent back with (correctionEnvelope
// .ts), in the order they were issued: the return record, kept with
// the verdict it fed, so outcomes can attribute corrections per unit
// later. And the hash of the Element's inputs when the standing
// finish was sealed — the dispatch-time comparison that tells a
// standing pass from a stale one (the unit-return rule). Both absent
// on records written before they existed, and never invented for them.

import type { ClaimCheck } from "./finishClaims.ts";
import { parseCorrectionEnvelope, type CorrectionEnvelope } from "./correctionEnvelope.ts";
import type { VerifyTally } from "./verifyReads.ts";

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
  /**
   * v2 only, and optional within it: the run's verify accounting —
   * declared writes read back (checked), and how each read-back ended
   * (ok / mismatched / unverified). Absent when no verify-declared
   * write ran in the run.
   */
  verify?: VerifyTally;
  /**
   * v2 only, and optional within it (B3): the corrections this run's
   * finishes were sent back with, in order — each the envelope the
   * agent received, naming its unit. Absent when no finish was sent
   * back, and on records written before envelopes existed.
   */
  corrections?: CorrectionEnvelope[];
  /**
   * v2 only, and optional within it (B3): the hash of the Element's
   * inputs (its row plus the definition it followed) at the moment
   * this record was sealed. The unit-return rule compares it against
   * the inputs at dispatch: a standing pass holds only for the work
   * that was actually judged. Absent on records written before it
   * was kept — and an absent hash proves nothing, so those passes
   * do not hold.
   */
  inputsHash?: string;
  /**
   * v2 only, and optional within it (B10): the run's chain-denial
   * accounting — how many integration calls the chain fence refused
   * in the run's final slice (the tally is per-slice, like B2's
   * verify accounting). Absent when nothing was refused — most
   * runs, and every unscoped one.
   */
  chain?: { denied: number };
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
  /**
   * The run's verify accounting, counted by code as its declared writes
   * landed (verifyReads.ts). Optional: a driver with no integration
   * writes supplies none, and the record then carries none.
   */
  verifyTally?: VerifyTally | null;
  /**
   * B3: the corrections issued during this run, in order (the
   * envelopes the agent received). Optional: a driver that renders
   * plain returns supplies none, and the record then carries none.
   */
  corrections?: readonly CorrectionEnvelope[];
  /**
   * B3: the hash of the Element's inputs when the standing finish was
   * sealed (correctionEnvelope.ts elementInputsCanonical, hashed by
   * the driver). Null when the driver could not take it.
   */
  inputsHash?: string | null;
  /**
   * B10: how many integration calls the chain fence refused during
   * the sealed slice, counted by the driver as the refusals were
   * delivered. Optional: a run with no scope (or no refusals)
   * supplies none, and the record then carries none.
   */
  chainDenied?: number | null;
}

const claimFields = (input: VerdictInputs): Pick<RunVerdict, "claims" | "claimGaps"> => ({
  claims: { ...input.claimCheck.counts },
  claimGaps: input.claimCheck.gaps.slice(0, 5),
});

const verifyFields = (input: VerdictInputs): Pick<RunVerdict, "verify"> => (
  input.verifyTally && input.verifyTally.checked > 0 ? { verify: { ...input.verifyTally } } : {}
);

const chainFields = (input: VerdictInputs): Pick<RunVerdict, "chain"> => (
  input.chainDenied && input.chainDenied > 0 ? { chain: { denied: input.chainDenied } } : {}
);

const correctionFields = (input: VerdictInputs): Pick<RunVerdict, "corrections" | "inputsHash"> => ({
  ...(input.corrections?.length ? { corrections: input.corrections.map((c) => ({ ...c, unit: { ...c.unit }, reason: [...c.reason], evidence: { ...c.evidence, artifactIds: [...c.evidence.artifactIds] } })) } : {}),
  ...(input.inputsHash ? { inputsHash: input.inputsHash } : {}),
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
  ...verifyFields(input),
  ...correctionFields(input),
  ...chainFields(input),
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
      ...verifyFields(input),
      ...correctionFields(input),
      ...chainFields(input),
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
  const withClaims: RunVerdict = {
    ...base,
    claims: { total: c.total as number, sourced: c.sourced as number, stale: c.stale as number },
    claimGaps: [...(r.claimGaps as string[])],
  };
  // The verify accounting is optional within v2 (absent = no declared
  // write ran), but when present it must be exact: four counts whose
  // outcomes sum to the checks.
  let out: RunVerdict = withClaims;
  if (r.verify !== undefined) {
    const verify = r.verify;
    if (!verify || typeof verify !== "object" || Array.isArray(verify)) return null;
    const vt = verify as Record<string, unknown>;
    if (!count(vt.checked) || !count(vt.ok) || !count(vt.mismatched) || !count(vt.unverified)) return null;
    if ((vt.ok as number) + (vt.mismatched as number) + (vt.unverified as number) !== (vt.checked as number)) return null;
    out = {
      ...out,
      verify: { checked: vt.checked as number, ok: vt.ok as number, mismatched: vt.mismatched as number, unverified: vt.unverified as number },
    };
  }
  // B3's fields are optional within v2 the same way, and exact when
  // present: the inputs hash is a non-empty string, and every
  // correction must parse as the envelope it claims to be — one bad
  // entry refuses the record, as with every field above.
  if (r.inputsHash !== undefined) {
    if (typeof r.inputsHash !== "string" || !r.inputsHash) return null;
    out = { ...out, inputsHash: r.inputsHash };
  }
  if (r.corrections !== undefined) {
    if (!Array.isArray(r.corrections)) return null;
    const corrections: CorrectionEnvelope[] = [];
    for (const entry of r.corrections) {
      const parsed = parseCorrectionEnvelope(entry);
      if (!parsed) return null;
      corrections.push(parsed);
    }
    out = { ...out, corrections };
  }
  // B10's block is optional within v2 the same way (absent = nothing
  // was refused), and exact when present: one non-negative count.
  if (r.chain !== undefined) {
    const chain = r.chain;
    if (!chain || typeof chain !== "object" || Array.isArray(chain)) return null;
    const ct = chain as Record<string, unknown>;
    if (!count(ct.denied)) return null;
    out = { ...out, chain: { denied: ct.denied as number } };
  }
  return out;
}
