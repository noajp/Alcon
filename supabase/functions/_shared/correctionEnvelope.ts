// The correction envelope (back-half B3): what a sent-back finish
// carries, and the rules that judge corrections after the fact. A return
// travels with five things (the Loops-and-Graphs return discipline):
// the UNIT it belongs to, the VERDICT, the REASON, the EVIDENCE the
// check read, and the SCOPE the correction is bounded to. Before this
// piece the loop's return was a prose list of gaps: the unit was
// implied, the evidence lived in a different record, and nothing said
// the correction may not wander into adjacent work.
//
// Pure throughout: run-agent assembles envelopes from the verdict and
// the run row at revision time, seals them onto the verdict record
// (runVerdict.ts carries them, optional within v2), and the dispatch
// and heartbeat rules below judge standing records — never a model's
// text. Three consumers, one shape:
//
//   - the revision message an agent receives is the formatted
//     envelope, so what it is told and what the record keeps are the
//     same facts;
//   - the unit-return rule: an Element whose standing verdict is a
//     pass (or whose readings a person accepted) is not re-run by a
//     re-dispatch — skipped by record, and only while its inputs are
//     provably the inputs that passed;
//   - the exhausted unit: a run whose revisions ran out stands failed,
//     and the fault is then in the plan, not the unit — the heartbeat
//     raises it once, as a candidate, naming the Element and the
//     standing gaps.

import { MAX_REVISIONS } from "./agentLoop.ts";
import type { HeartbeatSignal } from "./heartbeatSnapshot.ts";

/** Which check sent the finish back. Kept apart on the envelope
 *  because calibration (B5) pairs each class with human outcomes
 *  separately: a mechanical finding is code's judgement, a verifier
 *  gap is a second reader's. */
export type CorrectionSource = "mechanical" | "verifier";

export interface CorrectionEnvelope {
  v: 1;
  /** UNIT: the Element whose work was returned — the only thing the
   *  correction may touch. */
  unit: { kind: "element"; id: string; title: string };
  /** VERDICT: a return is always a fail; a pass sends nothing back. */
  verdict: "fail";
  /** Which check returned it. */
  source: CorrectionSource;
  /** REASON: the return's findings, as issued (≤5). */
  reason: string[];
  /** EVIDENCE: what the check read, as stored — the 検証 step and the
   *  artifacts the verifier was shown. A mechanical return read the
   *  finish's own claims, so it names no step and no artifacts. */
  evidence: { verifyStepIdx: number | null; artifactIds: string[] };
  /** SCOPE: the line the correction is bounded by — this unit's
   *  outputs, the named reasons, nothing adjacent. */
  scope: string;
  /** The finish attempt that was returned (1 = the first finish). */
  attempt: number;
  /** Finish attempts a run is allowed in all (the cap, from the loop). */
  maxAttempts: number;
}

const MAX_REASONS = 5;

/** Pure. The scope every correction is bounded by: the gaps named in
 *  REASON, on this Element's outputs alone — a returned unit must not
 *  grow into its neighbours while nobody is watching. */
export function correctionScope(): string {
  return "直すのはこの Element の成果だけです。対象は REASON に挙がった不足のみで、隣接する Element や他の成果物、計画そのものには手を付けないでください。";
}

export interface CorrectionInput {
  unit: { id: string; title: string };
  source: CorrectionSource;
  /** The failing check's gaps, as issued; capped at five, as the
   *  verdict record caps them. */
  reason: readonly string[];
  evidence: { verifyStepIdx: number | null; artifactIds: readonly string[] };
  /** The finish attempt being returned (the loop's revision count). */
  attempt: number;
}

/** Pure. Assemble the envelope for one return. */
export function correctionEnvelopeOf(input: CorrectionInput): CorrectionEnvelope {
  return {
    v: 1,
    unit: { kind: "element", id: input.unit.id, title: input.unit.title },
    verdict: "fail",
    source: input.source,
    reason: input.reason.slice(0, MAX_REASONS),
    evidence: { verifyStepIdx: input.evidence.verifyStepIdx, artifactIds: [...input.evidence.artifactIds] },
    scope: correctionScope(),
    attempt: input.attempt,
    maxAttempts: MAX_REVISIONS + 1,
  };
}

/**
 * Pure. The message the agent receives when a finish is sent back: the
 * envelope, line by line, then the standing instruction about how a
 * revised finish reports its facts (the same closing the plain return
 * has always carried — the envelope changes the shape of the return,
 * not the reporting contract).
 */
export function formatCorrectionEnvelope(e: CorrectionEnvelope): string {
  const sourceLabel = e.source === "verifier" ? "検証役の判定" : "機械検査の指摘";
  const reason = e.reason.length ? e.reason.map((g) => `- ${g}`).join("\n") : "- 任務の完了条件を満たしていません。";
  const evidence = e.source === "verifier"
    ? `検証ステップ${e.evidence.verifyStepIdx != null ? ` #${e.evidence.verifyStepIdx}` : ""}、検証が読んだ成果物 ${e.evidence.artifactIds.length} 件${e.evidence.artifactIds.length ? `（${e.evidence.artifactIds.slice(0, 5).join(", ")}）` : ""}`
    : "機械検査による差し戻しのため検証ステップはありません。REASON は finish の claims への指摘です。";
  return `完了はまだ受け付けられません。検証の差し戻し（${sourceLabel}）です。

UNIT: Element「${e.unit.title}」（id: ${e.unit.id}）
VERDICT: fail（${e.attempt} 回目の完了報告 / 上限 ${e.maxAttempts} 回）
REASON:
${reason}
EVIDENCE: ${evidence}
SCOPE: ${e.scope}

道具を使って不足を埋め、成果物と報告を直してから、もう一度 finish を呼んでください。報告する事実は finish の claims に出典と取得時刻を付けて挙げ、どうしても確かめられない点は finish の unconfirmed に挙げてください。`;
}

const SOURCES: readonly string[] = ["mechanical", "verifier"];

/** Strict narrowing of the jsonb: an entry that is not exactly this
 *  shape is not an envelope (null), never a partially-read one — the
 *  same discipline the verdict record itself is read with. */
export function parseCorrectionEnvelope(raw: unknown): CorrectionEnvelope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || r.verdict !== "fail") return null;
  if (typeof r.source !== "string" || !SOURCES.includes(r.source)) return null;
  const unit = r.unit;
  if (!unit || typeof unit !== "object" || Array.isArray(unit)) return null;
  const u = unit as Record<string, unknown>;
  if (u.kind !== "element" || typeof u.id !== "string" || !u.id || typeof u.title !== "string") return null;
  if (!Array.isArray(r.reason) || r.reason.length > MAX_REASONS || !r.reason.every((g) => typeof g === "string")) return null;
  const evidence = r.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const ev = evidence as Record<string, unknown>;
  if (!(ev.verifyStepIdx === null || (typeof ev.verifyStepIdx === "number" && Number.isInteger(ev.verifyStepIdx) && ev.verifyStepIdx >= 0))) return null;
  if (!Array.isArray(ev.artifactIds) || !ev.artifactIds.every((id) => typeof id === "string")) return null;
  if (typeof r.scope !== "string" || !r.scope) return null;
  if (typeof r.attempt !== "number" || !Number.isInteger(r.attempt) || r.attempt < 1) return null;
  if (typeof r.maxAttempts !== "number" || !Number.isInteger(r.maxAttempts) || r.maxAttempts < 2 || r.attempt > r.maxAttempts) return null;
  return {
    v: 1,
    unit: { kind: "element", id: u.id as string, title: u.title as string },
    verdict: "fail",
    source: r.source as CorrectionSource,
    reason: [...(r.reason as string[])],
    evidence: { verifyStepIdx: ev.verifyStepIdx as number | null, artifactIds: [...(ev.artifactIds as string[])] },
    scope: r.scope as string,
    attempt: r.attempt as number,
    maxAttempts: r.maxAttempts as number,
  };
}

/** Pure. A run's correction history as a working document (the
 *  transcript) carries it: entries that parse are kept, the rest
 *  dropped — a transcript is rewritten every slice and must never
 *  trap the run on an old shape. The sealed record is the strict one
 *  (parseRunVerdict reads corrections through parseCorrectionEnvelope
 *  and refuses the whole record over a bad entry). */
export function parseCorrectionHistory(raw: unknown): CorrectionEnvelope[] {
  if (!Array.isArray(raw)) return [];
  const out: CorrectionEnvelope[] = [];
  for (const e of raw) {
    const parsed = parseCorrectionEnvelope(e);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ── The standing pass: inputs, and the unit-return rule ─────────────

/** What a run on an Element is given to work on: the Element row's
 *  ask, and the definition it follows, resolved the driver's way. */
export interface ElementInputs {
  title: string;
  description: string | null;
  /** The resolved definition's body — the instruction text itself, so
   *  any edit to what the work must follow shows as changed inputs.
   *  (The definition's version counter is bookkeeping about the body;
   *  the body is the input.) Null when the work follows no definition. */
  definitionBody: string | null;
}

/** Pure. The canonical form of an Element's inputs; the driver hashes
 *  this string (sha256) at the moment a finish is sealed and again at
 *  dispatch, and the unit-return rule compares the two hashes. */
export function elementInputsCanonical(inputs: ElementInputs): string {
  return JSON.stringify({ title: inputs.title, description: inputs.description ?? "", definition: inputs.definitionBody ?? "" });
}

/** The slice of a standing verdict the unit-return rule reads,
 *  structurally — correctionEnvelope does not import the verdict
 *  record's module (the record imports the envelope, not the reverse). */
export interface StandingVerdictLike {
  result: "pass" | "fail" | "unchecked";
  /** Hash of the Element's inputs when that verdict was sealed. */
  inputsHash?: string;
}

export interface StandingRecord {
  /** The Element's standing verdict: its latest verdict-bearing
   *  terminal run's record, or null when no run has been judged. */
  verdict: StandingVerdictLike | null;
  /** That run's proposed readings landed at acceptance — a person
   *  took the work in, numbers and all. */
  readingsLanded: boolean;
  /** The Element's inputs now, hashed the same way. */
  currentInputsHash: string | null;
}

export type StandingSkipReason = "verdict-pass" | "readings-landed";

/**
 * Pure. The unit-return rule: why a re-dispatch must skip this
 * Element, or null when it may run. A standing pass holds only while
 * the inputs that passed are provably the inputs now — the hash
 * sealed with the verdict against the hash taken at dispatch. A
 * missing hash on either side proves nothing, so nothing is skipped
 * on it: absence of evidence is not evidence, and the cost of the
 * doubt is a re-run, never stale work kept by mistake.
 */
export function standingSkipReason(rec: StandingRecord): StandingSkipReason | null {
  const verdict = rec.verdict;
  if (!verdict) return null;
  const sealed = verdict.inputsHash;
  if (!sealed || !rec.currentInputsHash || sealed !== rec.currentInputsHash) return null;
  if (verdict.result === "pass") return "verdict-pass";
  if (rec.readingsLanded) return "readings-landed";
  return null;
}

// ── The exhausted unit: a plan-level signal ─────────────────────────

/** One finished run, as the heartbeat's reader found it. */
export interface ExhaustedRunFact {
  runId: string;
  elementId: string | null;
  elementTitle: string | null;
  /** The run's sealed verdict, parsed (parseRunVerdict's shape). */
  verdict: { result: string; reason: string | null; gaps: readonly string[] } | null;
  finishedAt: string | null;
  updatedAt: string;
}

const LABEL_CAP = 220;

/**
 * Pure. The runs whose revisions ran out, as heartbeat signals: the
 * finish stood failed, so per the discipline the fault is in the plan
 * that produced the unit, and the loop cannot see the plan — a person
 * can. One signal per run (the fingerprint dedups it to one telling,
 * plus the snapshot's one escalation), naming the Element and the
 * standing gaps, pointed at the Strategy conversation where plans
 * are re-made. Nothing here acts: the heartbeat notifies, it does
 * not re-plan.
 */
export function correctionExhaustedSignals(rows: readonly ExhaustedRunFact[]): HeartbeatSignal[] {
  const out: HeartbeatSignal[] = [];
  for (const r of rows) {
    if (!r.elementId || !r.verdict) continue;
    if (r.verdict.result !== "fail" || r.verdict.reason !== "revisions-exhausted") continue;
    const title = r.elementTitle ?? "Element";
    const gaps = r.verdict.gaps.slice(0, 2).join("、");
    const label = (gaps ? `${title}（不足: ${gaps}）` : title).slice(0, LABEL_CAP);
    out.push({
      kind: "correction_exhausted", id: r.runId, since: r.finishedAt ?? r.updatedAt,
      label, place: "Strategy の会話で計画を見直せます",
    });
  }
  return out;
}
