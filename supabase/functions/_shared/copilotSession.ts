// What the Copilot's kept conversation (ai_sessions.messages) and its
// approvals share between the two writers that touch them: alcon-copilot,
// which starts a turn and persists the approval it stops for, and
// run-agent's resume driver, which answers the paused turn once the person
// decides and appends what the turn went on to say. Pure — no I/O, so the
// shapes are pinned by tests.
//
// The roles are fixed (the parity design): the display's truth is
// ai_sessions.messages, the model's context is the anchor run's
// transcript, the audit trail is the run's steps.

import type { ToolResult } from "./agentLoop.ts";

/** How long a Copilot approval waits for its person before it lapses.
 *  An Element's approval waits as long as it takes — it blocks one task.
 *  A Copilot approval blocks the person's whole conversation with the AI,
 *  and a stale one describes a moment that has passed, so it expires. */
export const COPILOT_APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Pure. When an approval made at `from` lapses undecided. */
export function copilotApprovalExpiresAt(from: Date): string {
  return new Date(from.getTime() + COPILOT_APPROVAL_TTL_MS).toISOString();
}

/** Pure. The results an expired approval answers its paused turn with:
 *  nothing ran, and the model is told why, so the conversation can go on. */
export function expiredApprovalResults(calls: { id: string }[]): ToolResult[] {
  return calls.map((call) => ({
    type: "tool_result",
    tool_use_id: call.id,
    is_error: true,
    content: "承認の期限（7日）が過ぎたため、この操作は実行されませんでした。必要なら、チャットで依頼し直してください。",
  }));
}

// ── The kept conversation's shapes ─────────────────────────────────────────
// ai_sessions.messages is jsonb the panel renders: user turns are text,
// assistant turns carry their text, their tool steps and any approval
// cards. The server appends in exactly the panel's shapes, so a resumed
// turn reads like one that never stopped.

export interface PanelToolEvent {
  name: string;
  input?: Record<string, unknown>;
  result?: { ok: boolean; rows?: number; error?: string };
}

export interface PanelApproval {
  calls: unknown[];
  inputHash: string;
  status: string;
  /** The anchor run and action a persisted approval is decided through;
   *  absent on a card kept before approvals were persisted. */
  runId?: string;
  actionId?: string;
  results?: { name: string; ok: boolean; content: string }[];
}

export interface PanelMessage {
  role: string;
  content: string;
  done?: boolean;
  toolEvents?: PanelToolEvent[];
  approvals?: PanelApproval[];
  [k: string]: unknown;
}

/** Pure. The kept messages with one persisted approval's decision written
 *  onto its card: its new status, and what its calls answered when they
 *  ran. Cards for other actions, and messages without the card, pass
 *  through untouched (same references). */
export function withApprovalDecision(
  messages: PanelMessage[],
  actionId: string,
  patch: { status: string; results?: { name: string; ok: boolean; content: string }[] },
): PanelMessage[] {
  return messages.map((m) => {
    if (!m.approvals?.some((a) => a.actionId === actionId)) return m;
    return {
      ...m,
      approvals: m.approvals.map((a) => (a.actionId === actionId ? { ...a, ...patch } : a)),
    };
  });
}

/** Pure. The assistant turn a resumed Copilot turn appends to the kept
 *  conversation: its words, the steps it took, and the approval card it
 *  stopped for, if it stopped again. */
export function resumedAssistantMessage(args: {
  text: string;
  toolEvents?: PanelToolEvent[];
  approval?: PanelApproval | null;
}): PanelMessage {
  return {
    role: "assistant",
    content: args.text,
    done: true,
    ...(args.toolEvents?.length ? { toolEvents: args.toolEvents } : {}),
    ...(args.approval ? { approvals: [args.approval] } : {}),
  };
}
