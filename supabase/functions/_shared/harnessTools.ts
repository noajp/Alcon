import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorMessage, type ToolDef, type ToolResult } from "./boardTools.ts";
import { definitionReading, parseDefinition } from "./definition.ts";

// Harnesses as skills: how a kind of work is carried out, readable from any
// entry. A harness is a row of `definitions` in a Space; the AI lists them by
// name and loads one's body when the work in front of it matches. Writing a
// Strategy's own harness stays writeInitiativeDefinition.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HARNESS_TOOLS: ToolDef[] = [
  {
    name: "listHarnesses",
    description: "Space のハーネス（仕事のやり方の定義）の一覧。名前と目的の 1 行だけを返す。いまの仕事に合うものがあれば readHarness で本文を読み、それに従う。spaceId を省くと見られる全 Space のもの。",
    input_schema: {
      type: "object",
      properties: { spaceId: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "readHarness",
    description: "ハーネスの本文（Markdown）と、エンジンがどう読むか（reads / missing）を返す。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

/** Pure. The one line a harness is listed with: its goal's first line. */
export function harnessSummary(body: string): string {
  const goal = parseDefinition(body).sections.goal.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).find(Boolean);
  return (goal ?? "").slice(0, 140);
}

export async function runHarnessTool(db: SupabaseClient, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "listHarnesses": {
        let q = db.from("definitions").select("id, name, body, activity_space_id").order("name").limit(200);
        if (input.spaceId) {
          const spaceId = String(input.spaceId);
          if (!UUID.test(spaceId)) return { ok: false, error: "spaceId は UUID で渡してください" };
          q = q.eq("activity_space_id", spaceId);
        }
        const { data, error } = await q;
        if (error) throw error;
        const spaceIds = [...new Set(((data ?? []) as { activity_space_id: string | null }[]).map((d) => d.activity_space_id).filter(Boolean))] as string[];
        const defaults = new Set<string>();
        if (spaceIds.length) {
          const { data: spaces } = await db.from("activity_spaces").select("default_definition_id").in("id", spaceIds);
          for (const s of (spaces ?? []) as { default_definition_id: string | null }[]) if (s.default_definition_id) defaults.add(s.default_definition_id);
        }
        const list = ((data ?? []) as { id: string; name: string; body: string; activity_space_id: string | null }[]).map((d) => ({
          id: d.id, name: d.name, summary: harnessSummary(d.body ?? ""), spaceId: d.activity_space_id, ...(defaults.has(d.id) ? { spaceDefault: true } : {}),
        }));
        return { ok: true, data: list, meta: { rows: list.length } };
      }
      case "readHarness": {
        const id = String(input.id ?? "").trim();
        if (!UUID.test(id)) return { ok: false, error: "id は UUID で渡してください（listHarnesses の id）" };
        const { data, error } = await db.from("definitions").select("id, name, body").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data) return { ok: false, error: "ハーネスが見つかりません" };
        const body = String((data as { body: string }).body ?? "");
        return { ok: true, data: { id, name: (data as { name: string }).name, body, reading: definitionReading(parseDefinition(body)) } };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
