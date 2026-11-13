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
//   0. A chain scope (B10): a call outside the fence its run was born
//      with is denied before anything else is consulted — before
//      the catalog's entry policy, before the manifest's own rules.
//      No mode, delegation, standing rule, autonomy grant or plan
//      approval composes over it, because every one of those reads
//      the verdict this function returns, and applyMode never moves
//      a deny. The fact is composed only for integration calls of a
//      scoped run (chainScope's chainFactFor); every other call
//      carries no fact and is judged exactly as before.
//   1. Clayware's own tools follow their entry policy.
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
  catalogDecision?: "allow" | "approve" | "deny";       // Clayware-internal tools
  isWrite: boolean;
  isRead: boolean;                                       // per-call read determination (command effect / readOnly / httpIsRead)
  manifest?: { permission: Permission; rule: number | null; critical: CriticalClass | null };
  rawHttp?: boolean;                                     // the manifest-less http_request tool
  critical?: CriticalClass | null;                       // non-manifest write (Drive tool names)
  delegation?: "approve_each" | "full_delegation" | null;
  /** Graduated autonomy (B7): the live auto grant standing for this
   *  call's command, when one does — a pre-composed fact the caller
   *  loaded from autonomy_grants, judged by verdictWithAutonomy
   *  below. It is data, not a branch: the floors never read it. */
  autonomyGrant?: { lane: 1 | 2; clean: number } | null;
  /** Capability attenuation (B10): this call's standing inside the
   *  chain scope its run was born with — a pre-composed fact like
   *  the grant beside it (chainScope's chainFactFor), present only
   *  when the run carries a scope and the call is an integration
   *  call. Unlike the grant, the floors DO read it: it is the first
   *  rule of approvalVerdict, a deny nothing downstream can lift —
   *  a grant composes over an ask, and an out-of-scope call's base
   *  is never an ask (D5: grants live inside the fence). */
  chain?: { inScope: boolean } | null;
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
  // Rule 0 (B10): the chain fence. Judged first, before the catalog
  // and the manifest, so the recorded reason for a doubly-refused
  // call is the fence's; and a deny here is terminal — applyMode
  // never moves a deny in any mode, verdictWithAutonomy lifts only
  // an ask, the decision path re-checks manifest rules but never
  // needs to re-check this (a scope cannot change after mint, which
  // the row's trigger guarantees).
  if (facts.chain && !facts.chain.inScope) return "deny";
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

/**
 * Why one call is being asked about — the vocabulary the approval card
 * and the settings screen share, so a person deciding and a person
 * configuring read one policy in one set of words. "mode" is the one
 * reason this function never returns: it belongs to the mode
 * composition, not the floors, and the caller that applies an "ask"
 * mode to a display whose own reason is null names it there
 * (displaysUnderMode in policyApproval.ts).
 */
export type AskReason = "critical" | "command" | "rule" | "mode" | "http" | "catalog";

/**
 * Pure. The reason a call's own facts hold it, or null when they let it
 * through (or refuse it — a denial is not asked about). Keyed off
 * approvalVerdict itself, so the reason can never name a hold the
 * verdict did not make: a critical class outranks a command's ask, a
 * rule-bound ask is the rule's, and a typed write that merely follows
 * its connection's delegation has no named reason.
 */
export function askReasonOf(facts: ApprovalFacts): AskReason | null {
  if (approvalVerdict(facts) !== "ask") return null;
  if (facts.catalogDecision !== undefined) return "catalog";
  if (facts.manifest) {
    if (facts.manifest.critical) return "critical";
    return facts.manifest.rule !== null ? "rule" : "command";
  }
  if (facts.critical) return "critical";
  if (facts.rawHttp) return "http";
  return null;
}

/**
 * Pure. The lift a call's facts contain: "delegation" when the call ran
 * unasked because full delegation lifted its command's ask — true
 * exactly when approvalVerdict's delegation branch produced the allow
 * for an ask-permission, rule-free, non-critical manifest command. The
 * check re-runs the verdict, so the two cannot drift: a rule-bound ask
 * (which asks under any delegation), a critical command, an allowed
 * command, and a call the floors refuse or hold for any other reason
 * are never a lift. The mode is not read here — a caller discloses a
 * lift when the call actually ran (its final verdict was allow); under
 * the free mode a delegation-lifted call is still this lift, not a
 * policy approval, because its own verdict never asked.
 */
export function liftOf(facts: ApprovalFacts): "delegation" | null {
  const m = facts.manifest;
  if (!m || facts.catalogDecision !== undefined || !facts.isWrite) return null;
  if (m.permission !== "ask" || m.rule !== null || m.critical) return null;
  return facts.delegation === "full_delegation" && approvalVerdict(facts) === "allow"
    ? "delegation"
    : null;
}

// ── Graduated autonomy (B7): the grant as one composed fact ───────────
//
// The track-record grant enters the composition here, as a
// pre-composed input — NOT as a branch inside the floors above.
// approvalVerdict and applyMode evaluate exactly as they did before
// grants existed; what a grant may do is defined entirely by
// grantLiftable + verdictWithAutonomy:
//
//   - It can only turn an ask that full delegation would already
//     have lifted: a manifest command whose own permission is "ask",
//     held by nothing else — no critical class (the floor is
//     evaluated on its own derivation, so lane 3 stays closed even
//     if a grant row names the command), no argument rule (a
//     rule-bound ask is the person's condition, not the connection's
//     default), no catalog or raw-HTTP hold.
//   - It never applies in the ask-every-time mode: earned autonomy
//     is a refinement of Auto, and a Space that asks every time is
//     told every time.
//   - In the free mode the ask is already lifted by the mode; the
//     grant changes only the record's attribution (the caller writes
//     the policy approval with decision_source "track-record"), so
//     the audit keeps distinguishing "the Space said always" from
//     "this action earned it".
//   - Deny is unreachable: grantLiftable requires the base verdict
//     to be "ask", and a denial's verdict is "deny".

/**
 * Pure. Whether this call's ask is the one kind a track-record grant
 * may lift: the command's own ask, under a delegation that does not
 * already lift it, held by no floor. Recomputed from the verdict so
 * the two cannot drift.
 */
export function grantLiftable(facts: ApprovalFacts): boolean {
  const m = facts.manifest;
  if (!m || facts.catalogDecision !== undefined || !facts.isWrite || facts.isRead) return false;
  if (m.permission !== "ask" || m.rule !== null || m.critical) return false;
  return approvalVerdict(facts) === "ask";
}

/**
 * Pure. The mode-aware verdict for one call, with the call's
 * standing autonomy grant composed over it. `lift` names the
 * track-record lift when the grant is what lets the call run
 * unasked (Auto) or the truer attribution for its record (Free) —
 * the caller then writes the call's policy approval with
 * decision_source "track-record" (policyApproval.ts). Without a
 * grant, or in the ask mode, this is verdictUnderMode exactly.
 */
export function verdictWithAutonomy(
  facts: ApprovalFacts,
  mode: ApprovalMode,
): { base: ApprovalVerdict; final: ApprovalVerdict; lift: "track-record" | null } {
  const base = approvalVerdict(facts);
  const final = applyMode(base, facts, mode);
  if (!facts.autonomyGrant || mode === "ask" || !grantLiftable(facts)) {
    return { base, final, lift: null };
  }
  return { base, final: "allow", lift: "track-record" };
}
