// The Copilot's anchor run: the run a session's approvals, resumptions
// and usage live on (20261123090000). alcon-copilot creates it when a turn
// starts and persists the approval a turn stops for; run-agent's resume
// driver reads the same rows back and answers the paused turn. All writes
// here are the service role's — the run's own bookkeeping, as for every
// run; nothing reaches data the person could not reach themselves.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { canonicalCalls, type Msg, type PendingApproval } from "./agentLoop.ts";
import { approvalSummary, type ApprovalDisplay } from "./integrationTools.ts";
import { sha256Hex } from "./googleOAuth.ts";
import { copilotApprovalExpiresAt, type PanelMessage } from "./copilotSession.ts";

/** How the Copilot signs its steps, comments and notifications. */
export const COPILOT_AGENT_NAME = "Alcon Copilot";

/** The anchor row's shape, as the Copilot machinery reads it. */
export interface CopilotAnchor {
  id: string;
  status: string;
  triggered_by: string | null;
  activity_space_id: string | null;
  ai_session_id: string | null;
  transcript: { messages: Msg[]; turns: number; nudges: number; pending?: unknown } | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | string;
  continuation_count: number;
  step_count: number;
  started_at: string | null;
}

const ANCHOR_COLUMNS =
  "id, status, triggered_by, activity_space_id, ai_session_id, transcript, input_tokens, output_tokens, cost_usd, continuation_count, step_count, started_at";
const OPEN_STATUSES = ["queued", "running", "awaiting_approval", "paused"];

/** The session's open anchor run, if it has one. */
export async function findCopilotAnchor(admin: SupabaseClient, sessionId: string): Promise<CopilotAnchor | null> {
  const { data } = await admin.from("agent_runs").select(ANCHOR_COLUMNS)
    .eq("ai_session_id", sessionId).in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as CopilotAnchor | null) ?? null;
}

/** Starts the session's anchor run. Two first turns racing settle on the
 *  one-open-anchor-per-session index: the loser's insert fails, and it
 *  reads the winner back instead. */
export async function createCopilotAnchor(
  admin: SupabaseClient,
  session: { id: string; user_id: string; activity_space_id: string },
): Promise<CopilotAnchor> {
  const { data, error } = await admin.from("agent_runs").insert({
    ai_session_id: session.id, triggered_by: session.user_id, mode: "copilot",
    status: "running", activity_space_id: session.activity_space_id, started_at: new Date().toISOString(),
  }).select(ANCHOR_COLUMNS).single();
  if (!error && data) return data as unknown as CopilotAnchor;
  const found = await findCopilotAnchor(admin, session.id);
  if (found) return found;
  throw new Error(`セッションの実行記録を作れませんでした: ${error?.message ?? "unknown"}`);
}

export interface PersistedApproval { actionId: string; inputHash: string; summary: string }

/**
 * A Copilot turn stopped for approval: the paused turn is saved on the
 * anchor (its transcript, as a run's own), the anchor goes to
 * awaiting_approval, the action is written with its expiry, and the
 * starter is told through the Inbox (the notification carries the action,
 * having no Element to carry). The caller owns the steps it writes.
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

/** Reads the kept conversation, changes it, writes it back. The anchor's
 *  claim serialises the writers — one driver at a time, and the panel
 *  does not write while a resume runs — so a plain read-modify-write is
 *  the honest shape here. */
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
