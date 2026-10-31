import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ToolDef, ToolResult } from "../_shared/boardTools.ts";

// Strategy reads and deletes — Vision, Portfolio, Initiative — with the
// caller's JWT, so RLS decides what each call sees and may remove. Deletes
// ask for the removed ids: a delete RLS refuses matches no row rather than
// erroring, and the answer must say so instead of reporting success.

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STRATEGY_TOOLS: ToolDef[] = [{
  name: "strategy",
  description:
    "Strategy side of a Space: Visions, Portfolios (bundles of Initiatives, may nest) and Initiatives (purpose, assumptions, decisions, success conditions). " +
    "These are NOT Objects or Elements — never use Object/Element tools for them. " +
    "actions: list (needs spaceId) returns {visions, portfolios, initiatives} with ids and names; " +
    "deletePortfolio (id) deletes a Portfolio and the Portfolios nested in it — its Initiatives stay, outside every Portfolio; " +
    "deleteInitiative (id) deletes an Initiative (only its creator can). Neither delete touches Objects or Elements.",
  input_schema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "deletePortfolio", "deleteInitiative"] },
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
      const [v, p] = await Promise.all([
        db.from("visions").select("id,name").eq("activity_space_id", spaceId).order("order_index"),
        db.from("portfolios").select("id,name,parent_id,vision_id").eq("activity_space_id", spaceId).order("order_index"),
      ]);
      if (v.error || p.error) return { ok: false, error: (v.error ?? p.error)!.message };
      const visionIds = (v.data ?? []).map((r) => r.id);
      const portfolioIds = (p.data ?? []).map((r) => r.id);
      // An Initiative belongs to the Space through its Vision or its Portfolio.
      const filters = [
        visionIds.length ? `vision_id.in.(${visionIds.join(",")})` : null,
        portfolioIds.length ? `portfolio_id.in.(${portfolioIds.join(",")})` : null,
      ].filter(Boolean).join(",");
      let initiatives: unknown[] = [];
      if (filters) {
        const s = await db.from("strategies").select("id,name,status,portfolio_id,vision_id").or(filters).order("created_at");
        if (s.error) return { ok: false, error: s.error.message };
        initiatives = s.data ?? [];
      }
      const data = { visions: v.data ?? [], portfolios: p.data ?? [], initiatives };
      return { ok: true, data, meta: { rows: data.visions.length + data.portfolios.length + initiatives.length } };
    }
    case "deletePortfolio": {
      const id = uuid(input.id, "id");
      const { data, error } = await db.from("portfolios").delete().eq("id", id).select("id");
      if (error) return { ok: false, error: error.message };
      if (!data?.length) return { ok: false, error: "Portfolio not found, or you may not delete it." };
      return { ok: true, data: { id, deleted: true }, meta: { rows: 1 } };
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
