import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ToolDef, ToolResult } from "../_shared/boardTools.ts";

// Strategy reads and deletes — Vision and Initiative — with the caller's
// JWT, so RLS decides what each call sees and may remove. Deletes ask for
// the removed ids: a delete RLS refuses matches no row rather than
// erroring, and the answer must say so instead of reporting success.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STRATEGY_TOOLS: ToolDef[] = [{
  name: "strategy",
  description:
    "Strategy side of a Space: Visions and Initiatives (purpose, assumptions, decisions, success conditions). Initiatives nest: parentIds names the Initiatives one sits in. " +
    "These are NOT Objects or Elements — never use Object/Element tools for them. " +
    "actions: list (needs spaceId) returns {visions, initiatives} with ids, names and parentIds; " +
    "deleteInitiative (id) deletes an Initiative (only its creator can); the Initiatives nested in it stay, at the top. It never touches Objects or Elements.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "deleteInitiative"] },
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
      const [v, s] = await Promise.all([
        db.from("visions").select("id,name").eq("activity_space_id", spaceId).order("order_index"),
        db.from("strategies").select("id,name,status,vision_id").eq("activity_space_id", spaceId).order("created_at"),
      ]);
      if (v.error || s.error) return { ok: false, error: (v.error ?? s.error)!.message };
      const rows = s.data ?? [];
      const ids = rows.map((r) => r.id);
      const parents = new Map<string, string[]>();
      if (ids.length) {
        const e = await db.from("strategy_children").select("parent_strategy_id,child_strategy_id").in("child_strategy_id", ids);
        if (e.error) return { ok: false, error: e.error.message };
        for (const edge of e.data ?? []) parents.set(edge.child_strategy_id, [...(parents.get(edge.child_strategy_id) ?? []), edge.parent_strategy_id]);
      }
      const initiatives = rows.map((r) => ({ ...r, parentIds: parents.get(r.id) ?? [] }));
      const data = { visions: v.data ?? [], initiatives };
      return { ok: true, data, meta: { rows: data.visions.length + initiatives.length } };
    }
    case "deleteInitiative": {
      const id = uuid(input.id, "id");
      const { data, error } = await db.from("strategies").delete().eq("id", id).select("id");
      if (error) {
        if (error.code === "23503") return { ok: false, error: "A Domain approach still points at this Initiative — remove it first." };
        return { ok: false, error: error.message };
      }
      if (!data?.length) return { ok: false, error: "Only the Initiative's creator can delete it (or it does not exist)." };
      return { ok: true, data: { id, deleted: true }, meta: { rows: 1 } };
    }
    default:
      return { ok: false, error: `unknown strategy action: ${String(input.action)}` };
  }
}
