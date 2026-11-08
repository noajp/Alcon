// A policy approval: what a person's approval leaves behind, left by the
// Space's approval mode instead. Under the free mode an ask collapses to
// allow (approvalPolicy.ts) — the caller's side of that bargain is this
// record: an agent_actions row in exactly the shape a pending approval
// would have carried (the calls, their display, the hash of exactly what
// runs), marked decision_source "policy" with the mode beside it, born
// "approved" and settled to executed/failed when the call lands. The
// audit then answers "what ran without asking, and under whose policy"
// from the same table it answers "what did a person approve" — and a
// mode can never become an invisible path around the record, because
// the only code that lifts an ask writes this row first.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalCalls, type ToolCall } from "./agentLoop.ts";
import { approvalSummary, type ApprovalDisplay } from "./integrationTools.ts";
import { sha256Hex } from "./googleOAuth.ts";
import type { ApprovalMode } from "./approvalPolicy.ts";
import type { VerifyCheck } from "./verifyReads.ts";

/** Pure. The row a policy approval is written as. Single-call, always:
 *  a batch a person would have approved together is still one execution
 *  per call here, so each record names exactly the call that ran. */
export function policyApprovalInsert(args: {
  runId: string;
  elementId: string | null;
  call: ToolCall;
  display: ApprovalDisplay;
  inputHash: string;
  mode: ApprovalMode;
  integrationId: string | null;
  decidedAt: string;
}): Record<string, unknown> {
  return {
    run_id: args.runId, element_id: args.elementId, tool_use_id: args.call.id, tool: args.call.name,
    input: { calls: [args.call], display: [args.display] }, input_hash: args.inputHash,
    summary: approvalSummary([args.display]), integration_id: args.integrationId,
    status: "approved", decided_at: args.decidedAt,
    decision_source: "policy", policy_mode: args.mode,
  };
}

/**
 * Writes the policy approval for one call about to run under the free
 * mode, and returns its row id (null when the write failed — the caller
 * says so on the run's trace; the execution itself is the person's
 * standing instruction and is not hostage to its bookkeeping).
 */
export async function recordPolicyApproval(
  admin: SupabaseClient,
  args: {
    runId: string; elementId: string | null; call: ToolCall; display: ApprovalDisplay;
    mode: ApprovalMode; integrationId: string | null;
  },
): Promise<string | null> {
  const inputHash = await sha256Hex(canonicalCalls([args.call]));
  const { data, error } = await admin.from("agent_actions").insert(policyApprovalInsert({
    runId: args.runId, elementId: args.elementId, call: args.call, display: args.display,
    inputHash, mode: args.mode, integrationId: args.integrationId, decidedAt: new Date().toISOString(),
  })).select("id").single();
  if (error || !data) {
    console.error("policy approval record failed", error?.message ?? "unknown");
    return null;
  }
  return data.id as string;
}

/** Settles a policy approval once its call has run, the way a decided
 *  batch settles: executed, or failed when the call answered in error.
 *  A verify read-back the call carried (B2) is sealed into the same
 *  result, so the per-call record answers "did it land as intended",
 *  not only "did it run". */
export async function settlePolicyApproval(
  admin: SupabaseClient, actionId: string, ok: boolean, verify?: VerifyCheck,
): Promise<void> {
  await admin.from("agent_actions").update({
    status: ok ? "executed" : "failed",
    result: { failed: ok ? 0 : 1, total: 1, ...(verify ? { verify } : {}) },
  }).eq("id", actionId).eq("status", "approved");
}

/**
 * Pure. The displays a pending approval is persisted with under a mode.
 * The ask mode offers nothing as rememberable — every write asks again
 * next time, so a card that offered "from now on, don't ask" would be
 * promising what the mode forbids. Other modes keep the displays as
 * built. The ask mode is also where a display earns the reason "mode":
 * a call its own facts let through is being asked about only because
 * this Space asks every time, and the composition that collapses its
 * verdict is the honest place to name that — a reason the facts
 * themselves gave (critical, a condition…) is carried through as built.
 */
export function displaysUnderMode(displays: ApprovalDisplay[], mode: ApprovalMode): ApprovalDisplay[] {
  return mode === "ask"
    ? displays.map((d) => ({ ...d, rememberable: false, askReason: d.askReason ?? "mode" }))
    : displays;
}
