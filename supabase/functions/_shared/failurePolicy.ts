// Failure policy (back-half B13): how a failure is classified, and
// what the work's contract says happens then. A definition's failure
// rows (definition.ts) speak first, the Space's installed exception
// catalog entries second, the engine defaults last — resolved FIELD
// BY FIELD, so a row that only speaks about compensation does not
// silently fix the retry count too. The defaults are exactly today's
// behaviour, named once: no engine retry, compensation asks (B9's
// COMPENSATION_DEFAULT), no directed escalation, no give-up cap — so
// a Space with no rows and no entries resolves to them whole, and
// nothing changes for it.
//
// This module also feeds B9's compensation seam: failurePolicySource
// adapts the resolution to the CompensationPolicySource the pass
// asks, so a definition row's `compensate: auto` or an entry's word
// reaches the rollback the row governs.
//
// The pure half (classification, entry parsing, resolution, the
// settle derivation) is judged here where tests pin it; the shell
// half reads a run's settled records for the settle classification
// and seals the settle's own record (failure_detail).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  isFailureClass, MAX_DECLARED_GIVE_UP, MAX_DECLARED_RETRY,
  type CompensatePolicy, type EscalateTarget, type FailureClass, type FailureRow,
  type ParsedDefinition,
} from "./definition.ts";
import { COMPENSATION_DEFAULT, type CompensationPolicySource } from "./compensation.ts";
import { isAuthFailure } from "./integrationClient.ts";
import type { VerifyCheck } from "./verifyReads.ts";

// ── Classification at the call ─────────────────────────────────────

/** The classes one call's failure can carry (a subset of FailureClass:
 *  the settle-only classes are never judged here). */
export type CallFailureClass =
  | "verify_mismatch" | "auth_failed" | "rate_limited" | "not_found"
  | "unavailable" | "read_failed" | "write_failed";

/** The signals one settled call offers, and nothing else: the
 *  executor's result, its verify read-back, whether it threw. A
 *  failure class is never read out of the model's prose. */
export interface CallFailureFacts {
  effect: "read" | "write";
  isError: boolean;
  verify?: VerifyCheck | null;
  /** The result / error text's head — what the status prefix and the
   *  text patterns read. */
  text?: string;
  /** The executor threw (a transport failure: DNS, timeout, a refused
   *  binding) instead of answering. */
  thrown?: boolean;
  httpStatus?: number | null;
}

/** Pure. The HTTP status a result text carries: the `HTTP <n>` prefix
 *  of an HTTP answer, or the status inside McpSession's auth refusal. */
export function httpStatusOf(text: string | undefined | null): number | null {
  if (!text) return null;
  const m = /^HTTP (\d{3})\b/.exec(text) ?? /認証に失敗しました（(\d{3})）/.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Pure. One call's failure class, or null when the call did not fail.
 * The order is the design's: a verify mismatch carries the decisive
 * fact that the write LANDED, so it outranks everything; auth is the
 * connection's state, the most specific reason a call failed; 429 and
 * 404 are facts the status states outright; a throw or a 5xx is the
 * shape of the other side's temporary trouble; what remains falls to
 * the call's effect. A verify that could not run (unverified) is not
 * a failure — the write stands and the result is not an error — so it
 * never reaches here, and isError false answers null before anything.
 */
export function classifyCallFailure(facts: CallFailureFacts): CallFailureClass | null {
  if (!facts.isError) return null;
  if (facts.verify && !facts.verify.ok && !facts.verify.unverified) return "verify_mismatch";
  const text = facts.text ?? "";
  if (isAuthFailure(text)) return "auth_failed";
  const status = facts.httpStatus ?? httpStatusOf(text);
  if (status === 429 || /rate.?limit|too many requests|レート制限/i.test(text)) return "rate_limited";
  if (status === 404 || /\bnot found\b|見つかりません/i.test(text)) return "not_found";
  if (facts.thrown || (status !== null && status >= 500)) return "unavailable";
  return facts.effect === "read" ? "read_failed" : "write_failed";
}

/** The classes a declared retry may act on. auth_failed is repaired
 *  through the capture-need path, not by repeating the refusal;
 *  verify_mismatch means the write landed, so a re-run would write
 *  twice. With the reads-only floor (the driver enforces it), these
 *  are the classes that can ever retry. */
export const FAILURE_RETRYABLE_CLASSES: readonly CallFailureClass[] = [
  "read_failed", "unavailable", "rate_limited", "not_found",
];

/** The fixed backoff between a call's attempts, in ms (a product
 *  constant, one place — a failure row carries no delay field). */
export const FAILURE_RETRY_BACKOFF_MS: readonly number[] = [1000, 3000, 8000];

// ── The exception catalog's entries ────────────────────────────────

/** How an entry finds its failures. Every PRESENT condition must
 *  hold (AND). At settle time only the class is asked (see
 *  resolveFailurePolicy): a settled run's failure usually has no
 *  single call to point at. */
export interface ExceptionMatch {
  errorClass: FailureClass | null;
  destinationPattern: string | null;
  tool: string | null;
}

/** One installed catalog entry, parsed and kept by the driver from
 *  assembly to settle — resolution after that is pure over this. */
export interface InstalledExceptionEntry {
  id: string;
  name: string;
  /** The catalog version the install recorded. */
  version: number;
  match: ExceptionMatch;
  rows: FailureRow[];
}

const isCompensatePolicy = (v: unknown): v is CompensatePolicy => v === "auto" || v === "ask" || v === "never";
const isEscalateTarget = (v: unknown): v is EscalateTarget => v === "owner" || v === "strategy" || v === "inbox";
const isBoundedInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Pure. A catalog item's payload, read as an exception entry — the
 * same rules a definition row lives under (escalate required, values
 * in range, no unknown class, no class twice). Anything unreadable
 * answers null: the entry does not exist, fail closed. A response
 * row may omit its class when the match names one; the match's class
 * fills it.
 */
export function parseExceptionEntry(raw: unknown): { match: ExceptionMatch; rows: FailureRow[] } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const m = r.match && typeof r.match === "object" && !Array.isArray(r.match)
    ? r.match as Record<string, unknown> : {};
  if (m.error_class != null && !isFailureClass(m.error_class)) return null;
  const errorClass = (m.error_class as FailureClass | null) ?? null;
  if (m.destination_pattern != null && typeof m.destination_pattern !== "string") return null;
  const destinationPattern = (m.destination_pattern as string | null) ?? null;
  if (destinationPattern !== null) {
    try { new RegExp(destinationPattern); } catch { return null; }
  }
  if (m.tool != null && typeof m.tool !== "string") return null;
  const tool = (m.tool as string | null) ?? null;
  if (!Array.isArray(r.response) || r.response.length === 0) return null;
  const rows: FailureRow[] = [];
  const seen = new Set<FailureClass>();
  for (const rawRow of r.response) {
    if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) return null;
    const row = rawRow as Record<string, unknown>;
    const cls = row.class == null ? errorClass : isFailureClass(row.class) ? row.class : null;
    if (!cls || seen.has(cls)) return null;
    seen.add(cls);
    if (row.retry != null && !isBoundedInt(row.retry, 0, MAX_DECLARED_RETRY)) return null;
    if (row.compensate != null && !isCompensatePolicy(row.compensate)) return null;
    if (!isEscalateTarget(row.escalate)) return null;
    if (row.give_up_after != null && !isBoundedInt(row.give_up_after, 1, MAX_DECLARED_GIVE_UP)) return null;
    rows.push({
      class: cls,
      retry: (row.retry as number | null) ?? null,
      compensate: (row.compensate as CompensatePolicy | null) ?? null,
      escalate: row.escalate,
      giveUpAfter: (row.give_up_after as number | null) ?? null,
    });
  }
  return { match: { errorClass, destinationPattern, tool }, rows };
}

// ── Resolution ─────────────────────────────────────────────────────

export type PolicyLayer = "definition" | "catalog" | "default";

/** What governs one failure class, field by field, with the layer
 *  that spoke for each — the record keeps the provenance, because
 *  "which rule fired" is a fact a person will ask about. */
export interface ResolvedFailurePolicy {
  retry: number;
  compensate: CompensatePolicy;
  escalate: EscalateTarget | null;
  giveUpAfter: number | null;
  source: Record<"retry" | "compensate" | "escalate" | "giveUpAfter", PolicyLayer>;
}

/** The engine defaults: today's behaviour, named once. */
export const FAILURE_DEFAULTS: ResolvedFailurePolicy = {
  retry: 0,
  compensate: COMPENSATION_DEFAULT,
  escalate: null,
  giveUpAfter: null,
  source: { retry: "default", compensate: "default", escalate: "default", giveUpAfter: "default" },
};

export const POLICY_LAYER_LABEL: Record<PolicyLayer, string> = {
  definition: "定義の失敗時の扱い",
  catalog: "例外カタログ",
  default: "エンジン既定",
};

export const ESCALATE_TARGET_LABEL: Record<EscalateTarget, string> = {
  owner: "オーナー",
  strategy: "Strategy のオーナー",
  inbox: "Inbox",
};

/** Pure. Whether an entry speaks to this resolution at all. With no
 *  `match` facts (a settle), only the class is asked; with them (a
 *  call, whose destination and tool are in hand), every present
 *  condition must hold, the destination pattern against ANY of the
 *  call's destination strings (the connection's name, the endpoint's
 *  host, the call's target key). */
function entryMatches(
  entry: InstalledExceptionEntry,
  cls: FailureClass,
  match?: { destination?: string | readonly (string | null)[] | null; tool?: string | null },
): boolean {
  const m = entry.match;
  if (m.errorClass !== null && m.errorClass !== cls) return false;
  if (!match) return true;
  if (m.tool !== null && m.tool !== (match.tool ?? null)) return false;
  if (m.destinationPattern !== null) {
    const candidates = match.destination == null ? []
      : typeof match.destination === "string" ? [match.destination] : match.destination;
    let re: RegExp;
    try { re = new RegExp(m.destinationPattern); } catch { return false; }
    if (!candidates.some((c) => !!c && re.test(c))) return false;
  }
  return true;
}

/**
 * Pure. The policy for one failure class: the definition's row, then
 * the installed entries in their given order (the catalog's sort,
 * then install time — the driver's load order), then the defaults,
 * each field falling through on its own. An entry speaks only for a
 * class its match admits and its response names.
 */
export function resolveFailurePolicy(args: {
  class: FailureClass;
  definition: ParsedDefinition | null;
  entries: readonly InstalledExceptionEntry[];
  match?: { destination?: string | readonly (string | null)[] | null; tool?: string | null };
}): ResolvedFailurePolicy {
  const defRow = args.definition?.failure.find((r) => r.class === args.class) ?? null;
  const entryRows: FailureRow[] = [];
  for (const entry of args.entries) {
    if (!entryMatches(entry, args.class, args.match)) continue;
    const row = entry.rows.find((r) => r.class === args.class);
    if (row) entryRows.push(row);
  }
  const layered = <T,>(defValue: T | null | undefined, field: "retry" | "compensate" | "escalate" | "giveUpAfter", fallback: T): { value: T; layer: PolicyLayer } => {
    if (defValue != null) return { value: defValue, layer: "definition" };
    for (const row of entryRows) {
      const v = row[field] as T | null;
      if (v != null) return { value: v, layer: "catalog" };
    }
    return { value: fallback, layer: "default" };
  };
  const retry = layered(defRow?.retry, "retry", FAILURE_DEFAULTS.retry);
  const compensate = layered(defRow?.compensate, "compensate", FAILURE_DEFAULTS.compensate);
  const escalate = layered(defRow?.escalate, "escalate", FAILURE_DEFAULTS.escalate);
  const giveUpAfter = layered(defRow?.giveUpAfter, "giveUpAfter", FAILURE_DEFAULTS.giveUpAfter);
  return {
    retry: Math.min(Math.max(retry.value, 0), MAX_DECLARED_RETRY),
    compensate: compensate.value,
    escalate: escalate.value,
    giveUpAfter: giveUpAfter.value,
    source: {
      retry: retry.layer, compensate: compensate.layer,
      escalate: escalate.layer, giveUpAfter: giveUpAfter.layer,
    },
  };
}

/**
 * Pure. The definition's exceptions section, applied to the Space's
 * installed set (§3.4): no section → everything installed is
 * consulted; a section → only the entries it names (∩ installed) —
 * restrictive when present, including a section that names nothing.
 * Applied once, at assembly, so the call seam and the settle read
 * the same consulted set.
 */
export function narrowEntriesByExceptions(
  definition: ParsedDefinition | null,
  entries: readonly InstalledExceptionEntry[],
): InstalledExceptionEntry[] {
  if (!definition?.exceptionsDeclared) return [...entries];
  const named = new Set(definition.exceptions.map((id) => id.toLowerCase()));
  return entries.filter((e) => named.has(e.id.toLowerCase()));
}

/** The B9 seam's supply: the pass asks for one class's compensation
 *  policy; the answer is the resolution's compensate field, settled
 *  (class-only match — a settle has no single call to point at). */
export function failurePolicySource(args: {
  definition: ParsedDefinition | null;
  entries: readonly InstalledExceptionEntry[];
}): CompensationPolicySource {
  return {
    policyFor: ({ failureClass }) => resolveFailurePolicy({
      class: isFailureClass(failureClass) ? failureClass : "run_failure",
      definition: args.definition,
      entries: args.entries,
    }).compensate,
  };
}

// ── Classification at the settle ───────────────────────────────────

export interface SettleFailureFacts {
  path: "finish" | "refusal" | "giveup" | "decision";
  verdictResult?: "pass" | "fail" | "unchecked" | null;
  /** The standing finish's stale-claim count (B1's mechanical tally). */
  claimsStale?: number;
  /** The class that fired the give-up, on the give-up path. */
  giveUpClass?: string | null;
  /** The class recorded when the compensation batch rested, on the
   *  decision path. */
  standingClass?: string | null;
  /** The run's failed calls' classes, newest first. */
  callClasses?: readonly (string | null)[];
  hasBreakerTrip?: boolean;
}

/**
 * Pure. The one class a run's failure settles under. The path decides
 * first (a refusal is a refusal; a give-up keeps the class that fired
 * it; a decision keeps the class its rest recorded). A finish the
 * verifier failed is judged by its claims: stale claims are their
 * own class — mechanically told apart — and the rest is revisions
 * run out. A finish that merely fell short (partial / blocked, no
 * verdict to name it) reads the run's calls: an auth failure anywhere
 * is the run's headline fact, a verify mismatch next, then the most
 * recent failure's class, then the breaker's trip, then the
 * catch-all B9 shipped with.
 */
export function settleFailureClassOf(facts: SettleFailureFacts): FailureClass {
  if (facts.path === "refusal") return "model_refusal";
  if (facts.path === "giveup") return isFailureClass(facts.giveUpClass) ? facts.giveUpClass : "run_failure";
  if (facts.path === "decision") return isFailureClass(facts.standingClass) ? facts.standingClass : "run_failure";
  if (facts.verdictResult === "fail") {
    return (facts.claimsStale ?? 0) > 0 ? "stale_claims" : "revisions_exhausted";
  }
  const classes = (facts.callClasses ?? []).filter(isFailureClass);
  if (classes.includes("auth_failed")) return "auth_failed";
  if (classes.includes("verify_mismatch")) return "verify_mismatch";
  if (classes.length) return classes[0];
  if (facts.hasBreakerTrip) return "breaker_tripped";
  return "run_failure";
}

/**
 * The settle classification's shell: reads the run's settled call
 * classes (newest first) and whether a breaker ever tripped it, but
 * only on the one path that needs them — a finish with no failing
 * verdict. Every other path derives from facts the driver already
 * holds, and never touches the database for them.
 */
export async function classifySettledFailure(admin: SupabaseClient, args: {
  runId: string;
  path: SettleFailureFacts["path"];
  verdictResult?: SettleFailureFacts["verdictResult"];
  claimsStale?: number;
  giveUpClass?: string | null;
  standingClass?: string | null;
}): Promise<FailureClass> {
  if (args.path !== "finish" || args.verdictResult === "fail") {
    return settleFailureClassOf({ ...args, callClasses: [], hasBreakerTrip: false });
  }
  let callClasses: (string | null)[] = [];
  let hasBreakerTrip = false;
  try {
    const { data } = await admin.from("integration_call_log")
      .select("failure_class").eq("run_id", args.runId).eq("ok", false)
      .order("seq", { ascending: false }).limit(200);
    callClasses = ((data ?? []) as { failure_class: string | null }[]).map((r) => r.failure_class);
  } catch { /* the record is evidence; its absence reads as no failed calls */ }
  try {
    const { count } = await admin.from("breaker_trips")
      .select("id", { count: "exact", head: true }).eq("run_id", args.runId);
    hasBreakerTrip = (count ?? 0) > 0;
  } catch { hasBreakerTrip = false; }
  return settleFailureClassOf({ ...args, callClasses, hasBreakerTrip });
}

// ── The settle's record ────────────────────────────────────────────

/** What the settle decided, as data on the run (agent_runs.
 *  failure_detail): the class, the compensation policy and the layer
 *  that spoke for it, the escalation likewise, the run's retry total
 *  and the give-up that fired, if one did. The audit's drill-down
 *  reads this; the step on the run says the same in prose. */
export interface FailureDetail {
  class: FailureClass;
  compensate: { policy: CompensatePolicy; source: PolicyLayer };
  escalate: { target: EscalateTarget; source: PolicyLayer } | null;
  retries: number;
  giveUp: { count: number } | null;
  at: string;
}

/** Pure. A settle's record from its class and its resolved policy. */
export function failureDetailOf(args: {
  failureClass: FailureClass;
  policy: ResolvedFailurePolicy;
  retries: number;
  giveUp: { count: number } | null;
  at: Date;
}): FailureDetail {
  return {
    class: args.failureClass,
    compensate: { policy: args.policy.compensate, source: args.policy.source.compensate },
    escalate: args.policy.escalate
      ? { target: args.policy.escalate, source: args.policy.source.escalate }
      : null,
    retries: args.retries,
    giveUp: args.giveUp,
    at: args.at.toISOString(),
  };
}

/** Seals a settle's record on the run. Best effort, like every
 *  record the engine keeps about its own acts: where the column does
 *  not exist yet the settle stands anyway, and loses only this. */
export async function sealFailureDetail(
  admin: SupabaseClient, runId: string, detail: FailureDetail,
): Promise<void> {
  await admin.from("agent_runs").update({ failure_detail: detail }).eq("id", runId)
    .then(() => {}, () => {});
}
