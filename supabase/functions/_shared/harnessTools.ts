import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorMessage, type BoardActor, type ToolDef, type ToolResult } from "./boardTools.ts";
import { checkHarness, definitionReading, parseDefinition, type Diagnostic } from "./definition.ts";

// Harnesses as skills: how a kind of work is carried out, readable from any
// entry. A harness is a row of `definitions` in a Space; the AI lists them by
// name and loads one's body when the work in front of it matches. Writing a
// Strategy's own harness stays writeInitiativeDefinition.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const HARNESS_TOOLS: ToolDef[] = [
  {
    name: "listHarnesses",
    description: "Space のハーネス（仕事のやり方の定義）の一覧。名前と目的の 1 行だけを返す。official は Clayware の公式カタログから入れたもの、spaceDefault はその Space の既定。いまの仕事に合うものがあれば readHarness で本文を読み、それに従う。spaceId を省くと見られる全 Space のもの。",
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

const BODY_HINT = "本文は Markdown。「# 目的」は必須。ほかに「# 進め方」「# 分け方」「# 止める条件」「# 使うコネクタ」「# 成果物の型」「# 点検」などの見出しを使う。";

/** Writing a Space's harnesses. A harness changes how Clayware's AI works in
 *  the Space, so it is checked as it is saved, the way the app's editor does:
 *  an error refuses the save, warnings and hints come back with the result. */
export const HARNESS_WRITE_TOOLS: ToolDef[] = [
  {
    name: "createHarness",
    description: `Space に新しいハーネス（仕事のやり方の定義）を作る。保存の前にアプリと同じ検査を通し、エラーがあれば保存せずに直し方を返す。${BODY_HINT} 作る前に、何を作るかを本人に確かめる。`,
    input_schema: {
      type: "object",
      properties: {
        spaceId: { type: "string", description: "Space の UUID（listHarnesses の spaceId、listMyDomains の activity_space_id）" },
        name: { type: "string", description: "ハーネスの名前" },
        body: { type: "string", description: "本文（Markdown）" },
      },
      required: ["spaceId", "name", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "updateHarness",
    description: `Space のハーネスの名前や本文を書き換える。その Space で Clayware の AI がどう働くかが変わるので、何をどう変えるかを本人に示して了解を得てから行う。保存の前にアプリと同じ検査を通し、エラーがあれば保存しない。${BODY_HINT}`,
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "ハーネスの UUID（listHarnesses の id）" },
        name: { type: "string", description: "新しい名前（変えないときは省く）" },
        body: { type: "string", description: "新しい本文の全体（変えないときは省く）" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

const MAX_BODY = 40_000;

/** Pure. The check a save must pass: the errors that refuse it, and the rest to report. */
export function harnessSaveCheck(body: string): { errors: Diagnostic[]; notes: Diagnostic[] } {
  const all = checkHarness(parseDefinition(body));
  return { errors: all.filter((d) => d.severity === "error"), notes: all.filter((d) => d.severity !== "error") };
}

/** Pure. A refused save, in words the AI can act on. */
export function harnessRefusal(errors: Diagnostic[]): string {
  return `ハーネスに直すところがあるため保存していません。\n${errors.map((d) => `- ${d.code} ${d.message}${d.fix ? ` ${d.fix}` : ""}`).join("\n")}`;
}

function textArg(v: unknown, label: string, max: number): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${label} を渡してください`);
  if (v.length > max) throw new Error(`${label} は ${max} 文字までです`);
  return v;
}

/** Pure. The one line a harness is listed with: its goal's first line. */
export function harnessSummary(body: string): string {
  const goal = parseDefinition(body).sections.goal.split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).find(Boolean);
  return (goal ?? "").slice(0, 140);
}

export async function runHarnessTool(db: SupabaseClient, name: string, input: Record<string, unknown>, actor?: BoardActor): Promise<ToolResult> {
  try {
    switch (name) {
      case "listHarnesses": {
        let q = db.from("definitions").select("id, name, body, activity_space_id, source_id").eq("enabled", true).order("name").limit(200);
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
        // Official: added from Clayware's own catalog (Discover), as the app's list marks it.
        const list = ((data ?? []) as { id: string; name: string; body: string; activity_space_id: string | null; source_id: string | null }[]).map((d) => ({
          id: d.id, name: d.name, summary: harnessSummary(d.body ?? ""), spaceId: d.activity_space_id,
          ...(d.source_id ? { official: true } : {}), ...(defaults.has(d.id) ? { spaceDefault: true } : {}),
        }));
        return { ok: true, data: list, meta: { rows: list.length } };
      }
      case "readHarness": {
        const id = String(input.id ?? "").trim();
        if (!UUID.test(id)) return { ok: false, error: "id は UUID で渡してください（listHarnesses の id）" };
        const { data, error } = await db.from("definitions").select("id, name, body, enabled").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!data) return { ok: false, error: "ハーネスが見つかりません" };
        if (!(data as { enabled: boolean }).enabled) return { ok: false, error: `ハーネス「${(data as { name: string }).name}」は無効化されています` };
        const body = String((data as { body: string }).body ?? "");
        return { ok: true, data: { id, name: (data as { name: string }).name, body, reading: definitionReading(parseDefinition(body)) } };
      }
      case "createHarness": {
        const spaceId = String(input.spaceId ?? "").trim();
        if (!UUID.test(spaceId)) return { ok: false, error: "spaceId は UUID で渡してください" };
        const harnessName = textArg(input.name, "name", 200).trim();
        const body = textArg(input.body, "body", MAX_BODY);
        const check = harnessSaveCheck(body);
        if (check.errors.length) return { ok: false, error: harnessRefusal(check.errors) };
        const createdBy = actor?.userId ?? (await db.auth.getUser()).data.user?.id ?? null;
        const { data, error } = await db.from("definitions")
          .insert({ activity_space_id: spaceId, name: harnessName, body, created_by: createdBy })
          .select("id").single();
        if (error) throw error;
        return { ok: true, data: { id: (data as { id: string }).id, name: harnessName, notes: check.notes, reading: definitionReading(parseDefinition(body)) } };
      }
      case "updateHarness": {
        const id = String(input.id ?? "").trim();
        if (!UUID.test(id)) return { ok: false, error: "id は UUID で渡してください（listHarnesses の id）" };
        const patch: Record<string, unknown> = {};
        if (input.name !== undefined) patch.name = textArg(input.name, "name", 200).trim();
        if (input.body !== undefined) patch.body = textArg(input.body, "body", MAX_BODY);
        if (!Object.keys(patch).length) return { ok: false, error: "name か body を渡してください" };
        const { data: current, error: readError } = await db.from("definitions").select("id, name, body").eq("id", id).maybeSingle();
        if (readError) throw readError;
        if (!current) return { ok: false, error: "ハーネスが見つかりません" };
        const previousName = String((current as { name: string }).name);
        const body = typeof patch.body === "string" ? patch.body : String((current as { body: string }).body ?? "");
        const check = harnessSaveCheck(body);
        if (patch.body !== undefined && check.errors.length) return { ok: false, error: harnessRefusal(check.errors) };
        const { data, error } = await db.from("definitions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select("id, name");
        if (error) throw error;
        if (!data?.length) return { ok: false, error: "このハーネスを書き換える権限がありません" };
        return { ok: true, data: { id, name: (data[0] as { name: string }).name, previousName, notes: check.notes, reading: definitionReading(parseDefinition(body)) } };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
