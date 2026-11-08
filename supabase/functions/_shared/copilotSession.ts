// What the Copilot's kept conversation (ai_sessions.messages) and its
// approvals share: the shapes Athena's chat driver writes as it drives a
// turn — appending the person's message, persisting the approval it
// stops for, answering the paused turn once the person decides — and
// the automations tick reads when an approval lapses. Pure — no I/O,
// so the shapes are pinned by tests.
//
// The roles are fixed (the parity design): the display's truth is
// ai_sessions.messages, the model's context is the session run's
// transcript, the audit trail is the run's steps.

import type { Msg, ToolResult } from "./agentLoop.ts";

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
  /** The session's run and action a persisted approval is decided through;
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

/**
 * Pure. A transcript seeded from the kept conversation, for a session
 * whose run carries none yet (kept before the chat driver, or whose
 * run never rested a transcript). The panel's messages map the way
 * the panel itself used to send them: the person's turns as text, the
 * assistant's as a text block. Tool steps are not reconstructed — the
 * kept conversation holds their results, not their call ids — so a
 * seeded context is words only, exactly what the model saw when the
 * panel still carried the history. A transcript opens with the person:
 * leading assistant turns (an answer kept without its question) drop.
 */
export function seedMessagesFromPanel(messages: PanelMessage[]): Msg[] {
  const seeded: Msg[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const names = (Array.isArray(m.attachments) ? m.attachments : [])
        .map((f) => (f as { name?: unknown } | null)?.name)
        .filter((n): n is string => typeof n === "string" && !!n);
      const text = m.content || (names.length ? `添付ファイル: ${names.join("、")}` : "");
      if (text) seeded.push({ role: "user", content: text });
    } else if (m.role === "assistant") {
      if (m.content?.trim()) seeded.push({ role: "assistant", content: [{ type: "text", text: m.content }] });
    }
  }
  while (seeded.length && seeded[0].role === "assistant") seeded.shift();
  return seeded;
}
