// Proposing a connection — one core, two drivers. The Strategy
// conversation's converse handler has always had propose_connection;
// the Copilot panel driver calls the same core here, so the two
// surfaces cannot drift apart on what counts as a need: the named
// connectors the Space has not connected, or connected but failed its
// latest connection test (a reauth — it reads as connected nowhere).
//
// The proposal is never the connection: it becomes a connection_request
// record the person acts on from a card, and the connection itself
// stays the person's act in the connection dialog. The core returns the
// judgement; each driver renders its own step/message from it.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ToolDef } from "./boardTools.ts";
import { connectorNeeds } from "./connectorNeeds.ts";

export const PROPOSE_CONNECTION_TOOL: ToolDef = {
  name: "propose_connection",
  description:
    "仕事に必要なコネクタが未接続（または接続テストが失敗して再接続が必要）なとき、会話に「接続する」カードを出す。接続そのものはしない — 人がカードからダイアログを開いて接続する。" +
    "names には未接続のコネクタ名（GitHub、Slack など公式名）を、waitingFor にはその接続を待っている仕事を短く書く。先に本当に未接続かを確認してから呼ぶこと（connected の一覧に無いこと）。",
  input_schema: {
    type: "object",
    properties: {
      names: { type: "array", items: { type: "string" }, description: "未接続のコネクタ名" },
      waitingFor: { type: "string", description: "その接続を待っている仕事（例: GitHub に PR を作る）" },
    },
    required: ["names", "waitingFor"],
    additionalProperties: false,
  },
};

export type ConnectionProposalResult =
  | { kind: "proposed"; names: string[]; waitingFor: string }
  | { kind: "already"; asked: string[] }
  | { kind: "invalid"; error: string };

/** What the model is told after its card went out — one wording for both drivers. */
export const CONNECTION_PROPOSED_REPLY =
  "会話に「接続する」カードを出しました。接続は人がカードからダイアログを開いて行います。接続したとは言わないでください。";

/**
 * Judge a propose_connection call: validate the names, read the Space's
 * connections (name, preset, enabled AND the latest test — an expired
 * connection counts as a need), and say what is still needed. No writes:
 * the driver records the proposal in its own medium.
 */
export async function resolveConnectionProposal(
  db: SupabaseClient,
  spaceId: string | null,
  input: Record<string, unknown> | undefined,
): Promise<ConnectionProposalResult> {
  const asked = (Array.isArray(input?.names) ? input.names : [])
    .map((n) => (typeof n === "string" ? n.trim().slice(0, 80) : ""))
    .filter(Boolean)
    .slice(0, 5);
  const waitingFor = typeof input?.waitingFor === "string" ? input.waitingFor.trim().slice(0, 300) : "";
  if (!asked.length || !waitingFor) {
    return { kind: "invalid", error: "names（未接続のコネクタ名）と waitingFor（待っている仕事）が要ります。" };
  }
  const { data: rows } = spaceId
    ? await db.from("integrations")
      .select("name, preset, enabled, last_test")
      .eq("activity_space_id", spaceId)
      .in("kind", ["mcp", "http"])
    : { data: [] as { name: string; preset: string | null; enabled: boolean; last_test: unknown }[] };
  const needs = connectorNeeds(asked, rows ?? []);
  if (!needs.length) return { kind: "already", asked };
  return { kind: "proposed", names: needs.map((n) => n.name), waitingFor };
}
