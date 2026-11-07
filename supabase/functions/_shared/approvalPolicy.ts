import type { CriticalClass, Permission } from "./connectorManifest.ts";

// Whether one call waits for a person's approval, as a pure decision over
// the facts run-agent already has. The whole policy lives here so the
// order cannot drift between call sites:
//
//   1. Alcon's own tools follow their entry policy.
//   2. A call that is not a write never asks.
//   3. A manifest command: a denial is not asked about (the executor
//      refuses it); a critical command always asks — full delegation, an
//      "allow" permission and an argument rule that says allow do not
//      lift it; a rule-bound ask asks under any delegation; a command
//      ask is lifted by full delegation.
//   4. A critical call with no manifest (a typed Drive tool) always asks.
//   5. The raw http_request tool has no manifest, so the method is the
//      only contract: non-read methods ask under every delegation.
//   6. A read never asks.
//   7. Anything else follows the connection's delegation; an unknown
//      delegation asks.

export interface ApprovalFacts {
  catalogDecision?: "allow" | "approve" | "deny";       // Alcon-internal tools
  isWrite: boolean;
  isRead: boolean;                                       // per-call read determination (command effect / readOnly / httpIsRead)
  manifest?: { permission: Permission; rule: number | null; critical: CriticalClass | null };
  rawHttp?: boolean;                                     // the manifest-less http_request tool
  critical?: CriticalClass | null;                       // non-manifest write (Drive tool names)
  delegation?: "approve_each" | "full_delegation" | null;
}

export function needsApprovalFor(facts: ApprovalFacts): boolean {
  if (facts.catalogDecision !== undefined) return facts.catalogDecision === "approve";
  if (!facts.isWrite) return false;
  if (facts.manifest) {
    const m = facts.manifest;
    if (m.permission === "deny") return false;
    if (m.critical) return true;
    if (m.permission !== "ask") return false;
    if (m.rule !== null) return true;
    return facts.delegation !== "full_delegation";
  }
  if (facts.critical) return true;
  if (facts.rawHttp) return !facts.isRead;
  if (facts.isRead) return false;
  return facts.delegation !== "full_delegation";
}
