import type { CriticalClass, Permission } from "./connectorManifest.ts";

// Whether one call waits for a person's approval, as a pure decision over
// the facts run-agent already has. The whole policy lives here so the
// order cannot drift between call sites. The decision is a verdict
// first — allow, ask, or deny — and a Space's approval mode is then
// applied on top of it. needsApprovalFor, the question every host asked
// before modes, is the verdict read one way, so there is one
// implementation and the modes compose over it rather than beside it.
//
// The verdict's order (today's semantics, unchanged):
//
//   1. Alcon's own tools follow their entry policy.
//   2. A call that is not a write never asks.
//   3. A manifest command: a denial is not asked about (it is refused);
//      a critical command always asks — full delegation, an "allow"
//      permission and an argument rule that says allow do not lift it;
//      a rule-bound ask asks under any delegation; a command ask is
//      lifted by full delegation.
//   4. A critical call with no manifest (a typed Drive tool) always asks.
//   5. The raw http_request tool has no manifest, so the method is the
//      only contract: non-read methods ask under every delegation.
//   6. A read never asks.
//   7. Anything else follows the connection's delegation; an unknown
//      delegation asks.
//
// Approval modes — the Space's policy layer ABOVE those floors (a
// connection's command permissions and argument rules, an integration's
// delegation). A mode only ever changes how an ask is handled, never
// what is allowed:
//
//   "ask"  — every effective write asks, whatever allowed it below: a
//     command's allow, a standing rule, full delegation, a catalog allow
//     all collapse to ask, and nothing is offered as rememberable.
//   "auto" — the verdict, unchanged: only what asks today asks. The
//     default; what every Space did before modes existed.
//   "free" — an ask collapses to allow, and the caller records the
//     execution as a policy approval: the same audit shape a person's
//     approval leaves, marked with decision_source "policy".
//
// Three invariants hold in every mode:
//
//   deny stays deny — a prohibition a person set (a command's
//     permission, a catalog entry's refusal) outranks any mode.
//   reads never ask — the modes govern effects, and a read has none.
//   The rest of the floor is not in this file at all: the destination
//     guards, the Vault's secret rules, a connection's consent and a
//     drafted connection's activation never read the mode.

export interface ApprovalFacts {
  catalogDecision?: "allow" | "approve" | "deny";       // Alcon-internal tools
  isWrite: boolean;
  isRead: boolean;                                       // per-call read determination (command effect / readOnly / httpIsRead)
  manifest?: { permission: Permission; rule: number | null; critical: CriticalClass | null };
  rawHttp?: boolean;                                     // the manifest-less http_request tool
  critical?: CriticalClass | null;                       // non-manifest write (Drive tool names)
  delegation?: "approve_each" | "full_delegation" | null;
}

/** What the floors below the mode say about one call. */
export type ApprovalVerdict = "allow" | "ask" | "deny";

/** A Space's approval mode. Personal (Space-less) work is always "auto". */
export type ApprovalMode = "ask" | "auto" | "free";

export const APPROVAL_MODES: readonly ApprovalMode[] = ["ask", "auto", "free"];

/** Pure. A stored value read as a mode; anything unknown is "auto" — the
 *  mode that changes nothing — so a corrupt or legacy value can never
 *  widen what runs unasked. */
export function approvalModeOf(value: unknown): ApprovalMode {
  return value === "ask" || value === "free" ? value : "auto";
}

/**
 * Pure. The verdict for one call, before any mode: today's decision
 * raised to three values, so a denial is named as one instead of hiding
 * inside "does not ask". `needsApprovalFor(f) === (approvalVerdict(f)
 * === "ask")` for every input — the tests pin exactly that.
 */
export function approvalVerdict(facts: ApprovalFacts): ApprovalVerdict {
  if (facts.catalogDecision !== undefined) {
    return facts.catalogDecision === "approve" ? "ask" : facts.catalogDecision;
  }
  if (!facts.isWrite) return "allow";
  if (facts.manifest) {
    const m = facts.manifest;
    if (m.permission === "deny") return "deny";
    if (m.critical) return "ask";
    if (m.permission !== "ask") return "allow";
    if (m.rule !== null) return "ask";
    return facts.delegation === "full_delegation" ? "allow" : "ask";
  }
  if (facts.critical) return "ask";
  if (facts.rawHttp) return facts.isRead ? "allow" : "ask";
  if (facts.isRead) return "allow";
  return facts.delegation === "full_delegation" ? "allow" : "ask";
}

/**
 * Pure. The Space's mode composed over a verdict. Deny is returned in
 * every mode; "auto" is the verdict itself. "free" turns an ask into an
 * allow the caller must record as a policy approval — the recording is
 * the caller's side of the bargain. "ask" turns an allow a write earned
 * below into an ask; a read's allow is untouched (a manifest read
 * command arrives with isRead true, a catalog read never reaches here
 * as a write), so reads never ask in any mode.
 */
export function applyMode(verdict: ApprovalVerdict, facts: ApprovalFacts, mode: ApprovalMode): ApprovalVerdict {
  if (verdict === "deny") return "deny";
  if (mode === "auto") return verdict;
  if (mode === "free") return verdict === "ask" ? "allow" : verdict;
  return verdict === "allow" && facts.isWrite && !facts.isRead ? "ask" : verdict;
}

/** Pure. The mode-aware verdict for one call: approvalVerdict composed
 *  with the Space's mode. The one function a driver needs. */
export function verdictUnderMode(facts: ApprovalFacts, mode: ApprovalMode): ApprovalVerdict {
  return applyMode(approvalVerdict(facts), facts, mode);
}

/** Pure. The original question every host asked before modes: does this
 *  call wait for a person, with no mode applied (mode "auto")?
 *  Implemented on approvalVerdict so the two can never drift apart. */
export function needsApprovalFor(facts: ApprovalFacts): boolean {
  return approvalVerdict(facts) === "ask";
}
