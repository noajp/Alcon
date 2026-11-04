import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ToolDef, ToolResult } from "../_shared/boardTools.ts";

// Strategy reads and deletes, with the caller's
// JWT, so RLS decides what each call sees and may remove. Deletes ask for
// the removed ids: a delete RLS refuses matches no row rather than
// erroring, and the answer must say so instead of reporting success.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STRATEGY_TOOLS: ToolDef[] = [{
  name: "strategy",
  description:
    "Strategy side of a Space: Strategies (purpose, assumptions, decisions, success conditions). Strategies nest without limit: parentIds names the Strategies one sits in; the top ones have none. " +
    "These are NOT Objects or Elements — never use Object/Element tools for them. " +
    "actions: list (needs spaceId) returns {strategies} with ids, names and parentIds; " +
    "deleteStrategy (id) deletes a Strategy (only its creator can); the Strategies nested in it stay, at the top. It never touches Objects or Elements.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "deleteStrategy"] },
      spaceId: { type: "string" },
      id: { type: "string" },
    },
    required: ["action"],
    additionalProperties: false,
  },
}];

function uuid(value: unknown, what: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(`${what} must be a UUID`);
  return value;
}

export async function runStrategyTool(db: SupabaseClient, input: Record<string, unknown>): Promise<ToolResult> {
  switch (input.action) {
    case "list": {
      const spaceId = uuid(input.spaceId, "spaceId");
      const s = await db.from("strategies").select("id,name,status").eq("activity_space_id", spaceId).order("created_at");
      if (s.error) return { ok: false, error: s.error.message };
      const rows = s.data ?? [];
      const ids = rows.map((r) => r.id);
      const parents = new Map<string, string[]>();
      if (ids.length) {
        const e = await db.from("strategy_children").select("parent_strategy_id,child_strategy_id").in("child_strategy_id", ids);
        if (e.error) return { ok: false, error: e.error.message };
        for (const edge of e.data ?? []) parents.set(edge.child_strategy_id, [...(parents.get(edge.child_strategy_id) ?? []), edge.parent_strategy_id]);
      }
      const strategies = rows.map((r) => ({ ...r, parentIds: parents.get(r.id) ?? [] }));
      return { ok: true, data: { strategies }, meta: { rows: strategies.length } };
    }
    case "deleteStrategy": {
      const id = uuid(input.id, "id");
      const { data, error } = await db.from("strategies").delete().eq("id", id).select("id");
      if (error) {
        if (error.code === "23503") return { ok: false, error: "A Domain approach still points at this Strategy — remove it first." };
        return { ok: false, error: error.message };
      }
      if (!data?.length) return { ok: false, error: "Only the Strategy's creator can delete it (or it does not exist)." };
      return { ok: true, data: { id, deleted: true }, meta: { rows: 1 } };
    }
    default:
      return { ok: false, error: `unknown strategy action: ${String(input.action)}` };
  }
}
