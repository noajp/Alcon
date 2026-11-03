import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorMessage, type ToolDef, type ToolResult } from "./boardTools.ts";

// Strategy reads — Initiatives with their intent (success conditions,
// premises, decisions) and the Objects that execute them, so an agent can
// read why an Element exists before it acts on it. Read-only: Initiatives
// are written by the person who owns them (strategies RLS is created_by).

export const STRATEGY_TOOLS: ToolDef[] = [
  {
    name: "listInitiatives",
    description: "閲覧できる Initiative（戦略の単位）の一覧。parentId を渡すと、その Initiative の中に入れ子になったものだけを返す。",
    input_schema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "親 Initiative の UUID（省略可）" },
        status: { type: "string", description: "active / archived など（省略可）" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "getInitiative",
    description: "Initiative の意図（成功条件・前提・意思決定などの intents）、配下の Object、子 Initiative を返す。Element に着手する前に、それが何のためにあるかを確かめるのに使う。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Initiative UUID" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

export async function runStrategyTool(
  supabase: SupabaseClient,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "listInitiatives": {
        let q = supabase
          .from("strategies")
          .select("id, name, description, status, vision_id, updated_at")
          .order("updated_at", { ascending: false })
          .limit(200);
        if (input.parentId) {
          const edges = await supabase.from("strategy_children").select("child_strategy_id").eq("parent_strategy_id", String(input.parentId));
          if (edges.error) throw edges.error;
          q = q.in("id", (edges.data ?? []).map((e) => e.child_strategy_id));
        }
        if (input.status) q = q.eq("status", String(input.status));
        const { data, error } = await q;
        if (error) throw error;
        return { ok: true, data, meta: { rows: data?.length ?? 0 } };
      }

      case "getInitiative": {
        const id = String(input.id ?? "").trim();
        if (!id) return { ok: false, error: "id is required" };
        const { data: initiative, error } = await supabase
          .from("strategies")
          .select("id, name, description, status, vision_id, created_at, updated_at")
          .eq("id", id).maybeSingle();
        if (error) throw error;
        if (!initiative) return { ok: false, error: "Initiative not found" };
        const [intents, links, children] = await Promise.all([
          supabase.from("intents")
            .select("id, kind, title, subtitle, status, horizon, target_value, actual_value, unit, direction, measured_at, decided_by_name, decided_at")
            .eq("strategy_id", id).is("superseded_by_intent_id", null)
            .order("order_index", { ascending: true }),
          supabase.from("strategy_objects").select("object_id").eq("strategy_id", id),
          supabase.from("strategy_children").select("child_strategy_id").eq("parent_strategy_id", id)
            .order("order_index", { ascending: true }),
        ]);
        if (intents.error) throw intents.error;
        const objectIds = (links.data ?? []).map((l: { object_id: string }) => l.object_id);
        const objects = objectIds.length
          ? (await supabase.from("objects").select("id, name, prefix, domain_id").in("id", objectIds).is("archived_at", null)).data ?? []
          : [];
        return {
          ok: true,
          data: {
            ...initiative,
            intents: intents.data ?? [],
            objects,
            childInitiativeIds: (children.data ?? []).map((c: { child_strategy_id: string }) => c.child_strategy_id),
          },
        };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
