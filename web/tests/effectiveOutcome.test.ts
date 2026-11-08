// The web mirror of the approval policy (catalog.ts's effectiveOutcome)
// is a COPY of the engine's composition — web code cannot import Edge
// Function modules — and this contract test is what keeps the copy
// honest: the full matrix of stored permission × rules × critical ×
// delegation × mode, for reads and writes, asserted against the
// engine's own approvalVerdict/applyMode imported from _shared.
//
// The assertions are semantic, not a re-encoding of the mirror: the
// mirror's kind must agree with the engine's final verdict (denied ⟺
// deny, asks ⟺ ask, runs ⟺ allow), and its why/how must name the
// branch that produced that verdict — the critical floor, the
// command's own ask, the mode's collapse of an allowed write, the
// command's own allow, full delegation's lift, or the free mode's
// recorded lift. Rule-carrying commands have no static outcome: the
// mirror says by-rule, and the engine indeed answers per call there.
import { describe, expect, it } from "vitest";
import { effectiveOutcome, policyLineFor } from "@/AIP/connectors/catalog";

type EnginePolicy = typeof import("../../supabase/functions/_shared/approvalPolicy.ts");
const engine = (await import(
  new URL("../../supabase/functions/_shared/approvalPolicy.ts", import.meta.url).pathname
)) as EnginePolicy;

type Mode = "ask" | "auto" | "free";
type Delegation = "approve_each" | "full_delegation";
type Permission = "allow" | "ask" | "deny";

const PERMISSIONS: Permission[] = ["allow", "ask", "deny"];
const DELEGATIONS: Delegation[] = ["approve_each", "full_delegation"];
const MODES: Mode[] = ["ask", "auto", "free"];
const EFFECTS = ["read", "write"] as const;
const CRITICALS = [null, "send"] as const;

function factsFor(permission: Permission, critical: "send" | null, delegation: Delegation) {
  return {
    isWrite: true,
    isRead: false,
    manifest: { permission, rule: null, critical },
    delegation,
  };
}

describe("effectiveOutcome — the web mirror against the engine", () => {
  it("agrees with the engine over the full rule-free matrix", () => {
    for (const permission of PERMISSIONS) {
      for (const critical of CRITICALS) {
        for (const delegation of DELEGATIONS) {
          for (const mode of MODES) {
            for (const effect of EFFECTS) {
              const facts = { ...factsFor(permission, critical, delegation), isRead: effect === "read" };
              const base = engine.approvalVerdict(facts);
              const final = engine.applyMode(base, facts, mode);
              const outcome = effectiveOutcome(
                { permission, effect, hasRules: false, critical },
                { delegation, mode },
              );
              const label = `${permission}/${critical}/${delegation}/${mode}/${effect} (base ${base}, final ${final})`;
              if (final === "deny") {
                expect(outcome, label).toEqual({ kind: "denied" });
              } else if (final === "ask") {
                expect(outcome.kind, label).toBe("asks");
                if (outcome.kind !== "asks") continue;
                // The why names the branch that asked: the critical
                // floor outranks everything; a base ask is the command's
                // own; a base allow that now asks is the mode's doing.
                if (critical) expect(outcome.why, label).toBe("critical");
                else if (base === "ask") expect(outcome.why, label).toBe("command");
                else expect(outcome.why, label).toBe("mode");
              } else {
                expect(outcome.kind, label).toBe("runs");
                if (outcome.kind !== "runs") continue;
                // The how names the branch that let it run: its own
                // allow, full delegation's lift of the command's ask,
                // or the free mode's recorded lift.
                if (base === "allow" && permission === "allow") expect(outcome.how, label).toBe("allowed");
                else if (base === "allow") expect(outcome.how, label).toBe("delegation");
                else {
                  expect(base, label).toBe("ask");
                  expect(outcome.how, label).toBe("mode-free");
                }
              }
            }
          }
        }
      }
    }
  });

  it("rule-carrying commands have no static outcome — the engine answers per call", () => {
    for (const delegation of DELEGATIONS) {
      for (const mode of MODES) {
        expect(effectiveOutcome(
          { permission: "ask", effect: "write", hasRules: true, critical: null },
          { delegation, mode },
        )).toEqual({ kind: "by-rule" });
      }
    }
    // And the engine really does vary with the rule the call matches:
    const allowRule = { isWrite: true, isRead: false, manifest: { permission: "allow" as const, rule: 0, critical: null }, delegation: "approve_each" as const };
    const askRule = { isWrite: true, isRead: false, manifest: { permission: "ask" as const, rule: 0, critical: null }, delegation: "approve_each" as const };
    expect(engine.approvalVerdict(allowRule)).toBe("allow");
    expect(engine.approvalVerdict(askRule)).toBe("ask");
    // Deny and critical outrank rules on both sides.
    expect(effectiveOutcome(
      { permission: "deny", effect: "write", hasRules: true, critical: null },
      { delegation: "full_delegation", mode: "free" },
    )).toEqual({ kind: "denied" });
    expect(effectiveOutcome(
      { permission: "allow", effect: "write", hasRules: true, critical: "send" },
      { delegation: "full_delegation", mode: "auto" },
    )).toEqual({ kind: "asks", why: "critical" });
    expect(engine.approvalVerdict({ isWrite: true, isRead: false, manifest: { permission: "allow", rule: 0, critical: "send" }, delegation: "full_delegation" })).toBe("ask");
    // The one lift of the critical floor: the free mode composes over
    // any ask (applyMode has no critical exception), recording it as a
    // policy approval — the mirror must say so too, rules or not.
    const criticalFacts = { isWrite: true, isRead: false, manifest: { permission: "ask" as const, rule: null, critical: "send" as const }, delegation: "approve_each" as const };
    expect(engine.applyMode(engine.approvalVerdict(criticalFacts), criticalFacts, "free")).toBe("allow");
    expect(effectiveOutcome(
      { permission: "ask", effect: "write", hasRules: false, critical: "send" },
      { delegation: "approve_each", mode: "free" },
    )).toEqual({ kind: "runs", how: "mode-free" });
  });

  it("reads are exempt from the ask-every-time collapse, like the engine", () => {
    const read = { isWrite: true, isRead: true, manifest: { permission: "allow" as const, rule: null, critical: null }, delegation: "approve_each" as const };
    expect(engine.applyMode(engine.approvalVerdict(read), read, "ask")).toBe("allow");
    expect(effectiveOutcome(
      { permission: "allow", effect: "read", hasRules: false, critical: null },
      { delegation: "approve_each", mode: "ask" },
    )).toEqual({ kind: "runs", how: "allowed" });
  });
});

describe("policyLineFor — one line per delegation × mode", () => {
  it("the mode dominates the line; delegation speaks only under auto", () => {
    const ask = policyLineFor("full_delegation", "ask");
    expect(policyLineFor("approve_each", "ask")).toBe(ask);
    const free = policyLineFor("approve_each", "free");
    expect(policyLineFor("full_delegation", "free")).toBe(free);
    expect(policyLineFor("full_delegation", "auto")).not.toBe(policyLineFor("approve_each", "auto"));
    expect(new Set([ask, free, policyLineFor("full_delegation", "auto"), policyLineFor("approve_each", "auto")]).size).toBe(4);
  });
});
