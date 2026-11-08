// A Copilot session's run bookkeeping, shared by the two writers that
// touch it: Athena's chat driver in run-agent, which persists the
// approval a turn stops for and appends what turns say to the kept
// conversation, and the automations tick, which lapses undecided
// Copilot approvals and answers their paused turns. All writes here
// are the service role's — the run's own bookkeeping, as for every
// run; nothing reaches data the person could not reach themselves.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalCalls, type Msg, type PendingApproval } from "./agentLoop.ts";
import { approvalSummary, type ApprovalDisplay } from "./integrationTools.ts";
import { sha256Hex } from "./googleOAuth.ts";
import { copilotApprovalExpiresAt, type PanelMessage } from "./copilotSession.ts";

/** How the Copilot signs its steps, comments and notifications. */
export const COPILOT_AGENT_NAME = "Alcon Copilot";

export interface PersistedApproval { actionId: string; inputHash: string; summary: string }

/**
 * A Copilot turn stopped for approval: the paused turn is saved on the
 * session's run (its transcript, as a run's own), the run goes to
 * awaiting_approval, the action is written with its expiry, and the
 * starter is told through the Inbox (the notification carries the
 * action, having no Element to carry). The caller owns the steps it
 * writes.
 */
export async function persistCopilotApproval(args: {
  admin: SupabaseClient;
  run: { id: string; triggered_by: string | null };
  pending: PendingApproval;
  messages: Msg[];
  turns: number;
  nudges: number;
  displays: ApprovalDisplay[];
  integrationId: string | null;
  now?: Date;
}): Promise<PersistedApproval> {
  const { admin, run, pending } = args;
  const now = args.now ?? new Date();
  const summary = approvalSummary(args.displays);
  const inputHash = await sha256Hex(canonicalCalls(pending.calls));
  // jsonb refuses NUL; tool output can carry it.
  const transcript = JSON.parse(
    JSON.stringify({ messages: args.messages, turns: args.turns, nudges: args.nudges, pending }).replace(/\\u0000/g, ""),
  );
  const { error: tErr } = await admin.from("agent_runs").update({ transcript }).eq("id", run.id);
  if (tErr) throw new Error(`経過を保存できませんでした: ${tErr.message}`);
  const { data: waiting } = await admin.from("agent_runs").update({ status: "awaiting_approval", summary })
    .eq("id", run.id).eq("status", "running").select("id").maybeSingle();
  if (!waiting) throw new Error("承認待ちに移れませんでした。");
  const { data: action, error: aErr } = await admin.from("agent_actions").insert({
    run_id: run.id, element_id: null, tool_use_id: pending.calls[0].id,
    tool: pending.calls.length === 1 ? pending.calls[0].name : "batch",
    input: { calls: pending.calls, display: args.displays }, input_hash: inputHash, summary,
    integration_id: args.integrationId, expires_at: copilotApprovalExpiresAt(now),
  }).select("id").single();
  if (aErr || !action) throw new Error(`承認依頼を保存できませんでした: ${aErr?.message ?? "unknown"}`);
  if (run.triggered_by) {
    await admin.from("notifications").insert({
      recipient_id: run.triggered_by, actor_name: COPILOT_AGENT_NAME, kind: "approval_requested",
      agent_action_id: action.id, title: `${COPILOT_AGENT_NAME} が承認を求めています`, body: summary,
    }).then(() => {}, () => {});
  }
  return { actionId: action.id as string, inputHash, summary };
}

/** Reads the kept conversation, changes it, writes it back. The run's
 *  claim serialises the writers — one driver at a time — so a plain
 *  read-modify-write is the honest shape here. */
export async function updateCopilotSessionMessages(
  admin: SupabaseClient,
  sessionId: string,
  change: (messages: PanelMessage[]) => PanelMessage[],
): Promise<void> {
  const { data } = await admin.from("ai_sessions").select("messages").eq("id", sessionId).maybeSingle();
  const current = (Array.isArray(data?.messages) ? data.messages : []) as PanelMessage[];
  await admin.from("ai_sessions")
    .update({ messages: change(current), updated_at: new Date().toISOString() })
    .eq("id", sessionId);
}
