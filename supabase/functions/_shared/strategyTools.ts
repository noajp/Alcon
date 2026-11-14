import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { errorMessage, type ToolDef, type ToolResult } from "./boardTools.ts";
import { definitionReading, parseDefinition } from "./definition.ts";
import { harnessRefusal, harnessSaveCheck } from "./harnessTools.ts";
import { actionStateOf, barriersOf, type ExecutionRunRow } from "./executionState.ts";

// Strategy reads — Initiatives with their intent (success conditions,
// premises, decisions) and the Objects that execute them, so an agent can
// read why an Element exists before it acts on it.
//
// Strategy writes — the intent itself: purpose, success conditions,
// premises, decisions, nested Initiatives and the definition the work
// follows. They run with the person's JWT, so RLS keeps them to the
// Initiative's owner. Which entries offer them is the catalog's policy.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STRATEGY_TOOLS: ToolDef[] = [
  {
    name: "listInitiatives",
    description: "閲覧できる Initiative（Strategy）の一覧。各行の parentIds は入れ子の親（最上位は空）。parentId でその中の子だけ、spaceId でその Space のものだけに絞る。",
    input_schema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "親 Initiative の UUID（省略可）" },
        spaceId: { type: "string", description: "Space の UUID（省略可）" },
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
  {
    name: "getInitiativeExecution",
    description: "Strategy の実行状態を返す: Object ごとの Element（状態・担当・動詞）、各 Element の最新の実行（状態・要約・エラー・検証結果と不足点・保留中の指標報告）、未完了の依存、全体の集計。実行について聞かれたら推測せずこれで読む。",
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
          .select("id, name, description, status, updated_at")
          .order("updated_at", { ascending: false })
          .limit(200);
        if (input.parentId) {
          const edges = await supabase.from("strategy_children").select("child_strategy_id").eq("parent_strategy_id", String(input.parentId));
          if (edges.error) throw edges.error;
          q = q.in("id", (edges.data ?? []).map((e) => e.child_strategy_id));
        }
        if (input.spaceId) q = q.eq("activity_space_id", String(input.spaceId));
        if (input.status) q = q.eq("status", String(input.status));
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data ?? []) as { id: string }[];
        const parents = new Map<string, string[]>();
        if (rows.length) {
          const e = await supabase.from("strategy_children").select("parent_strategy_id, child_strategy_id").in("child_strategy_id", rows.map((r) => r.id));
          if (e.error) throw e.error;
          for (const edge of (e.data ?? []) as { parent_strategy_id: string; child_strategy_id: string }[]) {
            parents.set(edge.child_strategy_id, [...(parents.get(edge.child_strategy_id) ?? []), edge.parent_strategy_id]);
          }
        }
        const list = rows.map((r) => ({ ...r, parentIds: parents.get(r.id) ?? [] }));
        return { ok: true, data: list, meta: { rows: list.length } };
      }

      case "getInitiative": {
        let id = String(input.id ?? "").trim();
        if (!id) return { ok: false, error: "id is required" };
        // A name in place of the UUID: the one visible Initiative it names.
        if (!UUID.test(id)) {
          const { data: named, error: nameError } = await supabase.from("strategies").select("id, name").ilike("name", id).limit(2);
          if (nameError) throw nameError;
          if (!named?.length) return { ok: false, error: `「${id}」という Initiative は見つかりません。listInitiatives で id を確かめてください。` };
          if (named.length > 1) return { ok: false, error: `「${id}」という名前の Initiative が複数あります。listInitiatives で id を確かめてください。` };
          id = named[0].id as string;
        }
        const { data: initiative, error } = await supabase
          .from("strategies")
          .select("id, name, description, status, created_at, updated_at")
          .eq("id", id).maybeSingle();
        if (error) throw error;
        if (!initiative) return { ok: false, error: "Initiative not found" };
        const [intents, links, children] = await Promise.all([
          supabase.from("intents")
            .select("id, kind, title, subtitle, status, verdict, horizon, target_value, actual_value, unit, direction, measured_at, decided_by_name, decided_at")
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

      case "getInitiativeExecution": {
        let id = String(input.id ?? "").trim();
        if (!id) return { ok: false, error: "id is required" };
        if (!UUID.test(id)) {
          const { data: named, error: nameError } = await supabase.from("strategies").select("id, name").ilike("name", id).limit(2);
          if (nameError) throw nameError;
          if (!named?.length) return { ok: false, error: `「${id}」という Initiative は見つかりません。listInitiatives で id を確かめてください。` };
          if (named.length > 1) return { ok: false, error: `「${id}」という名前の Initiative が複数あります。listInitiatives で id を確かめてください。` };
          id = named[0].id as string;
        }
        const { data: initiative, error } = await supabase.from("strategies").select("id, name").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!initiative) return { ok: false, error: "Initiative not found" };
        const links = await supabase.from("strategy_objects").select("object_id").eq("strategy_id", id);
        if (links.error) throw links.error;
        const objectIds = (links.data ?? []).map((l: { object_id: string }) => l.object_id);
        const objectRows = (objectIds.length
          ? (await supabase.from("objects").select("id, name").in("id", objectIds).is("archived_at", null)).data ?? []
          : []) as { id: string; name: string }[];
        const { data: elementData, error: elementError } = objectRows.length
          ? await supabase.from("elements")
            .select("id, title, status, object_id, action, claimed_by, claim_expires_at")
            .in("object_id", objectRows.map((o) => o.id)).is("parent_id", null).limit(300)
          : { data: [], error: null };
        if (elementError) throw elementError;
        const elementRows = (elementData ?? []) as unknown as {
          id: string; title: string; status: string | null; object_id: string;
          action: unknown; claimed_by: string | null; claim_expires_at: string | null;
        }[];
        const elementIds = elementRows.map((e) => e.id);
        const empty = { data: [], error: null };
        const [assigneesRes, edgesRes, runsRes] = await Promise.all([
          elementIds.length ? supabase.from("element_assignees").select("element_id, role, workers(type, ai_config)").in("element_id", elementIds) : empty,
          elementIds.length ? supabase.from("element_edges").select("from_element, to_element").in("to_element", elementIds).eq("edge_type", "depends_on") : empty,
          elementIds.length ? supabase.from("agent_runs").select("id, element_id, status, summary, error, verdict, proposed_readings, created_at").in("element_id", elementIds).order("created_at", { ascending: false }).limit(1000) : empty,
        ]);
        if (assigneesRes.error) throw assigneesRes.error;
        if (edgesRes.error) throw edgesRes.error;
        if (runsRes.error) throw runsRes.error;

        type AssigneeRow = { element_id: string; role: string | null; workers: { type: string | null; ai_config: unknown } | null };
        const assigneesByElement = new Map<string, AssigneeRow[]>();
        for (const a of (assigneesRes.data ?? []) as unknown as AssigneeRow[]) {
          assigneesByElement.set(a.element_id, [...(assigneesByElement.get(a.element_id) ?? []), a]);
        }
        const now = Date.now();
        const execElements = elementRows.map((e) => {
          const mine = assigneesByElement.get(e.id) ?? [];
          const doer = mine.find((a) => a.role !== "reviewer" && a.workers);
          return {
            id: e.id, title: e.title, status: e.status, object_id: e.object_id,
            action: typeof e.action === "string" ? e.action : null,
            assignee: (doer ? (doer.workers!.type === "ai_agent" ? "ai" : "human") : null) as "ai" | "human" | null,
            claudeCode: mine.some((a) => a.role !== "reviewer" && (a.workers?.ai_config as { runner?: unknown } | null)?.runner === "claude-code"),
            leased: !!e.claimed_by && !!e.claim_expires_at && Date.parse(e.claim_expires_at) > now,
          };
        });
        type RunRow = ExecutionRunRow & { id: string; verdict: unknown; proposed_readings: unknown };
        const runRows = (runsRes.data ?? []) as unknown as RunRow[];
        const latestFull = new Map<string, RunRow>();
        for (const r of runRows) {
          const seen = latestFull.get(r.element_id);
          if (!seen || r.created_at > seen.created_at) latestFull.set(r.element_id, r);
        }
        const stateOf = new Map(execElements.map((e) => [e.id, actionStateOf(e, latestFull.get(e.id))]));
        const elementById = new Map(execElements.map((e) => [e.id, e]));
        const edges = (edgesRes.data ?? []) as { from_element: string; to_element: string }[];
        const blockersOf = (elementId: string) => edges
          .filter((edge) => edge.to_element === elementId && elementById.has(edge.from_element))
          .map((edge) => ({ title: elementById.get(edge.from_element)!.title, state: stateOf.get(edge.from_element)! }))
          .filter((b) => b.state !== "done" && b.state !== "cancelled");

        const verdictOf = (raw: unknown): { result: string; gaps: string[] } | null => {
          if (!raw || typeof raw !== "object") return null;
          const v = raw as { result?: unknown; gaps?: unknown };
          if (v.result !== "pass" && v.result !== "fail" && v.result !== "unchecked") return null;
          return { result: v.result, gaps: Array.isArray(v.gaps) ? v.gaps.filter((g): g is string => typeof g === "string").slice(0, 5) : [] };
        };
        const heldOf = (raw: unknown): { measureId: string; value: number }[] => {
          if (!Array.isArray(raw)) return [];
          return raw
            .filter((r) => !!r && typeof r === "object" && typeof (r as { measureId?: unknown }).measureId === "string" && (r as { applied?: unknown }).applied === false)
            .map((r) => {
              const held = r as { measureId: string; value?: unknown };
              return { measureId: held.measureId, value: typeof held.value === "number" ? held.value : 0 };
            });
        };
        const heldIds = new Set<string>();
        for (const r of latestFull.values()) for (const h of heldOf(r.proposed_readings)) heldIds.add(h.measureId);
        const measureTitles = new Map<string, string>();
        if (heldIds.size) {
          const { data: measures } = await supabase.from("intents").select("id, title").in("id", [...heldIds]);
          for (const m of (measures ?? []) as { id: string; title: string }[]) measureTitles.set(m.id, m.title);
        }

        const tallies = { total: 0, done: 0, running: 0, waiting: 0, blocked: 0, failed: 0, verdicts: { pass: 0, fail: 0, unchecked: 0 } };
        for (const e of execElements) {
          const state = stateOf.get(e.id)!;
          if (state !== "cancelled") tallies.total += 1;
          if (state === "done") tallies.done += 1;
          else if (state === "running") tallies.running += 1;
          else if (state === "waiting") tallies.waiting += 1;
          else if (state === "blocked") tallies.blocked += 1;
          else if (state === "failed") tallies.failed += 1;
          const v = verdictOf(latestFull.get(e.id)?.verdict);
          if (v) tallies.verdicts[v.result as "pass" | "fail" | "unchecked"] += 1;
        }
        const cut = (s: string | null): string | null => (s && s.length > 500 ? s.slice(0, 500) : s);
        return {
          ok: true,
          data: {
            strategyId: id,
            name: initiative.name,
            tallies,
            objects: objectRows.map((o) => ({
              name: o.name,
              elements: execElements.filter((e) => e.object_id === o.id).map((e) => {
                const run = latestFull.get(e.id);
                return {
                  id: e.id, title: e.title, status: e.status, action: e.action, assignee: e.assignee,
                  state: stateOf.get(e.id),
                  blockers: blockersOf(e.id),
                  latestRun: run ? {
                    id: run.id,
                    status: run.status, summary: cut(run.summary), error: cut(run.error),
                    verdict: verdictOf(run.verdict),
                    heldReadings: heldOf(run.proposed_readings).map((h) => ({ measureTitle: measureTitles.get(h.measureId) ?? h.measureId, value: h.value })),
                  } : null,
                };
              }),
            })),
            barriers: barriersOf(execElements, runRows),
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

// ── Writes ──────────────────────────────────────────────────────────────────

export type IntentKind = "measure" | "assumption" | "decision";
const INTENT_KINDS: IntentKind[] = ["measure", "assumption", "decision"];

export const STRATEGY_WRITE_TOOLS: ToolDef[] = [
  {
    name: "updateInitiative",
    description: "Initiative の名前と目的（説明）を書き換える。目的は「何を達成し、なぜやるか」を 1〜3 文で。決まったことだけを書き、推測で埋めない。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Initiative UUID" },
        name: { type: "string" },
        description: { type: "string", description: "目的" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "createInitiative",
    description: "Initiative（Strategy）を作る。parentId を渡すと、その中に筋道として子の Initiative（Sub Strategy）を作る。parentId がなければ spaceId の Space の最上位に作る。",
    input_schema: {
      type: "object",
      properties: {
        parentId: { type: "string", description: "親 Initiative の UUID（Sub Strategy を作るとき）" },
        spaceId: { type: "string", description: "Space の UUID（最上位に作るとき）" },
        name: { type: "string" },
        description: { type: "string", description: "目的" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "deleteInitiative",
    description: "Initiative を削除する（作った人だけができる）。中に入れ子の Initiative は残り、最上位に移る。Object と Element には触れない。人が名指しして消すと言ったものだけ。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string", description: "Initiative UUID" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "addIntent",
    description:
      "Initiative に意図を 1 件足す。kind: measure（成功条件。数値の目標 targetValue と direction at_least/at_most が要る。単位は unit）、" +
      "assumption（前提・制約。note に崩れたときの影響）、decision（意思決定。note に捨てた選択肢、horizon に見直す日 YYYY-MM-DD）。" +
      "人が言ったこと・同意したことだけを書く。",
    input_schema: {
      type: "object",
      properties: {
        initiativeId: { type: "string" },
        kind: { type: "string", enum: INTENT_KINDS },
        title: { type: "string" },
        note: { type: "string" },
        targetValue: { type: "number" },
        unit: { type: "string" },
        direction: { type: "string", enum: ["at_least", "at_most"] },
        horizon: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["initiativeId", "kind", "title"],
      additionalProperties: false,
    },
  },
  {
    name: "updateIntent",
    description: "Initiative の意図（成功条件・前提・意思決定）を 1 件直す。渡した項目だけが変わる。status は on_track / at_risk / off_track / done。actualValue は成功条件の実績。",
    input_schema: {
      type: "object",
      properties: {
        initiativeId: { type: "string" },
        id: { type: "string", description: "意図の UUID（getInitiative の intents にある）" },
        title: { type: "string" },
        note: { type: "string" },
        status: { type: "string", enum: ["on_track", "at_risk", "off_track", "done"] },
        targetValue: { type: "number" },
        actualValue: { type: "number" },
        unit: { type: "string" },
        direction: { type: "string", enum: ["at_least", "at_most"] },
        horizon: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["initiativeId", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "removeIntent",
    description: "Initiative の意図を 1 件消す。人が消すと言ったものだけ。",
    input_schema: {
      type: "object",
      properties: { initiativeId: { type: "string" }, id: { type: "string" } },
      required: ["initiativeId", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "writeInitiativeDefinition",
    description:
      "Initiative の仕事の進め方を定義（Markdown）として書き、Initiative に結びつける。配下の Element を動かすエージェントはこれに従う。" +
      "見出しは # 目的 / # 条件 / # 進め方 / # 止める条件 / # 点検 / # 成果物の型（必要なものだけ）。答えにはエンジンがどう読んだかが返るので、人に見せて確かめる。",
    input_schema: {
      type: "object",
      properties: {
        initiativeId: { type: "string" },
        name: { type: "string", description: "定義の名前（省略時は Initiative の名前）" },
        body: { type: "string" },
      },
      required: ["initiativeId", "body"],
      additionalProperties: false,
    },
  },
];

const WRITE_NAMES = new Set(STRATEGY_WRITE_TOOLS.map((t) => t.name));
export function isStrategyWriteTool(name: string): boolean {
  return WRITE_NAMES.has(name);
}

function uuidOf(value: unknown, what: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!UUID.test(s)) throw new Error(`${what} は UUID で渡してください`);
  return s;
}

function textOf(value: unknown, what: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${what} が空です`);
  if (value.length > max) throw new Error(`${what} は ${max} 文字までです`);
  return value.trim();
}

/** Pure. The intents row a create or an edit writes, from the tool's input.
 *  A note goes where each kind keeps it: a decision's in `abandoned`, the
 *  others' in `subtitle`. Throws on input that would write something wrong. */
export function intentPatch(kind: IntentKind, input: Record<string, unknown>, creating: boolean): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (creating || input.title !== undefined) patch.title = textOf(input.title, "title", 2000);
  if (input.note !== undefined) {
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 2000) : null;
    patch[kind === "decision" ? "abandoned" : "subtitle"] = note;
  }
  if (input.status !== undefined) {
    if (!["on_track", "at_risk", "off_track", "done"].includes(String(input.status))) throw new Error("status が不正です");
    patch.status = input.status;
  }
  if (input.horizon !== undefined) {
    if (input.horizon !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.horizon))) throw new Error("horizon は YYYY-MM-DD で渡してください");
    patch.horizon = input.horizon;
  }
  const measureFields = ["targetValue", "actualValue", "unit", "direction"].filter((k) => input[k] !== undefined);
  if (kind !== "measure" && measureFields.length) throw new Error(`${measureFields.join(", ")} は成功条件（measure）にだけ書けます`);
  for (const [from, to] of [["targetValue", "target_value"], ["actualValue", "actual_value"]] as const) {
    if (input[from] === undefined) continue;
    if (typeof input[from] !== "number" || !Number.isFinite(input[from])) throw new Error(`${from} は数値で渡してください`);
    patch[to] = input[from];
    if (from === "actualValue") patch.measured_at = new Date().toISOString();
  }
  if (input.unit !== undefined) patch.unit = typeof input.unit === "string" && input.unit.trim() ? input.unit.trim().slice(0, 40) : null;
  if (input.direction !== undefined) {
    if (!["at_least", "at_most"].includes(String(input.direction))) throw new Error("direction は at_least か at_most です");
    patch.direction = input.direction;
  }
  if (creating && kind === "measure") {
    if (typeof patch.target_value !== "number") throw new Error("成功条件には targetValue（数値の目標）が要ります。数値にできないなら前提か意思決定として書いてください");
    patch.direction ??= "at_least";
  }
  return patch;
}

/** The Initiative's root intent — every other intent hangs under it. Made on first use. */
async function rootIntent(db: SupabaseClient, initiativeId: string, name: string): Promise<string> {
  const read = async () => {
    const { data, error } = await db.from("intents").select("id").eq("strategy_id", initiativeId).is("parent_intent_id", null).maybeSingle();
    if (error) throw error;
    return (data as { id: string } | null)?.id ?? null;
  };
  const found = await read();
  if (found) return found;
  const { data, error } = await db.from("intents")
    .insert({ strategy_id: initiativeId, parent_intent_id: null, kind: "master", title: name, status: "on_track", order_index: 0 })
    .select("id").single();
  if (error) {
    // Someone else made it meanwhile (the one-root index).
    if (error.code === "23505") { const again = await read(); if (again) return again; }
    throw error;
  }
  return (data as { id: string }).id;
}

async function ownInitiative(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("strategies").select("id, name, activity_space_id, definition_id").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Initiative が見つかりません");
  return data as { id: string; name: string; activity_space_id: string | null; definition_id: string | null };
}

/** A write RLS refused matches no row instead of erroring: say so. */
const NOT_OWNER = "書き込めませんでした。この Initiative を書き換えられるのは持ち主だけです。";

export async function runStrategyWriteTool(db: SupabaseClient, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case "updateInitiative": {
        const id = uuidOf(input.id, "id");
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (input.name !== undefined) patch.name = textOf(input.name, "name", 200);
        if (input.description !== undefined) patch.description = typeof input.description === "string" ? input.description.trim().slice(0, 4000) : null;
        if (Object.keys(patch).length === 1) return { ok: false, error: "name か description を渡してください" };
        const { data, error } = await db.from("strategies").update(patch).eq("id", id).select("id, name, description");
        if (error) throw error;
        if (!data?.length) return { ok: false, error: NOT_OWNER };
        return { ok: true, data: data[0] };
      }
      case "createInitiative": {
        const parent = input.parentId ? await ownInitiative(db, uuidOf(input.parentId, "parentId")) : null;
        const spaceId = parent ? parent.activity_space_id : input.spaceId ? uuidOf(input.spaceId, "spaceId") : null;
        if (!parent && !spaceId) return { ok: false, error: "parentId（Sub Strategy）か spaceId（最上位）を渡してください" };
        const { data: auth } = await db.auth.getUser();
        if (!auth.user) throw new Error("サインインが切れています");
        const { data: created, error } = await db.from("strategies").insert({
          name: textOf(input.name, "name", 200),
          description: typeof input.description === "string" ? input.description.trim().slice(0, 4000) || null : null,
          created_by: auth.user.id, activity_space_id: spaceId,
        }).select("id, name").single();
        if (error) throw error;
        if (!parent) return { ok: true, data: { ...created, parentIds: [] } };
        const link = await db.from("strategy_children").insert({ parent_strategy_id: parent.id, child_strategy_id: created.id });
        if (link.error) {
          await db.from("strategies").delete().eq("id", created.id);
          throw link.error;
        }
        return { ok: true, data: created };
      }
      case "deleteInitiative": {
        const id = uuidOf(input.id, "id");
        const { data, error } = await db.from("strategies").delete().eq("id", id).select("id");
        if (error) {
          if (error.code === "23503") return { ok: false, error: "この Initiative を指している Domain の取り組みがあります。先にそれを外してください。" };
          throw error;
        }
        if (!data?.length) return { ok: false, error: "削除できるのは Initiative を作った人だけです（または存在しません）。" };
        return { ok: true, data: { id, deleted: true } };
      }
      case "addIntent": {
        const kind = String(input.kind) as IntentKind;
        if (!INTENT_KINDS.includes(kind)) return { ok: false, error: "kind は measure / assumption / decision のどれかです" };
        const initiative = await ownInitiative(db, uuidOf(input.initiativeId, "initiativeId"));
        const patch = intentPatch(kind, input, true);
        const root = await rootIntent(db, initiative.id, initiative.name);
        const { count } = await db.from("intents").select("id", { count: "exact", head: true }).eq("parent_intent_id", root);
        const { data, error } = await db.from("intents").insert({
          ...patch, strategy_id: initiative.id, parent_intent_id: root, kind,
          ...(kind === "measure" ? {} : { decided_at: new Date().toISOString() }),
          order_index: (count ?? 0) + 1,
        }).setHeader("x-alcon-reading-source", "agent").select("id, kind, title").single();
        if (error) throw error;
        return { ok: true, data };
      }
      case "updateIntent":
      case "removeIntent": {
        const initiativeId = uuidOf(input.initiativeId, "initiativeId");
        const id = uuidOf(input.id, "id");
        const { data: row, error: readError } = await db.from("intents").select("id, kind, parent_intent_id").eq("id", id).eq("strategy_id", initiativeId).maybeSingle();
        if (readError) throw readError;
        if (!row || row.parent_intent_id === null) return { ok: false, error: "その意図はこの Initiative にありません" };
        const kind = (INTENT_KINDS as string[]).includes(row.kind) ? row.kind as IntentKind : "decision";
        const query = name === "removeIntent"
          ? db.from("intents").delete()
          : db.from("intents").update({ ...intentPatch(kind, input, false), updated_at: new Date().toISOString() }).setHeader("x-alcon-reading-source", "agent");
        const { data, error } = await query.eq("id", id).select("id, title");
        if (error) throw error;
        if (!data?.length) return { ok: false, error: NOT_OWNER };
        return { ok: true, data: name === "removeIntent" ? { id, removed: true } : data[0] };
      }
      case "writeInitiativeDefinition": {
        const initiative = await ownInitiative(db, uuidOf(input.initiativeId, "initiativeId"));
        if (!initiative.activity_space_id) return { ok: false, error: "Space に属していない Initiative には定義を結びつけられません" };
        const body = textOf(input.body, "body", 40_000);
        const check = harnessSaveCheck(body);
        if (check.errors.length) return { ok: false, error: harnessRefusal(check.errors) };
        const defName = typeof input.name === "string" && input.name.trim() ? input.name.trim().slice(0, 200) : initiative.name;
        // The Initiative's own definition is rewritten in place; one shared
        // with other Initiatives or Elements is left as it is and a new one made.
        // A disabled one is not edited or resurrected either: a new, enabled
        // definition is made and linked instead.
        let definitionId = initiative.definition_id;
        if (definitionId) {
          const { data: linked } = await db.from("definitions").select("enabled").eq("id", definitionId).maybeSingle();
          if (linked && !(linked as { enabled: boolean }).enabled) definitionId = null;
        }
        if (definitionId) {
          const [others, elements] = await Promise.all([
            db.from("strategies").select("id", { count: "exact", head: true }).eq("definition_id", definitionId).neq("id", initiative.id),
            db.from("elements").select("id", { count: "exact", head: true }).eq("definition_id", definitionId),
          ]);
          if ((others.count ?? 0) > 0 || (elements.count ?? 0) > 0) definitionId = null;
        }
        if (definitionId) {
          const { data, error } = await db.from("definitions").update({ name: defName, body, updated_at: new Date().toISOString() }).eq("id", definitionId).select("id");
          if (error) throw error;
          if (!data?.length) definitionId = null;
        }
        if (!definitionId) {
          const { data: auth } = await db.auth.getUser();
          const { data, error } = await db.from("definitions")
            .insert({ activity_space_id: initiative.activity_space_id, name: defName, body, created_by: auth.user?.id ?? null }).select("id").single();
          if (error) throw error;
          definitionId = (data as { id: string }).id;
          const { data: linked, error: linkError } = await db.from("strategies").update({ definition_id: definitionId }).eq("id", initiative.id).select("id");
          if (linkError) throw linkError;
          if (!linked?.length) return { ok: false, error: NOT_OWNER };
        }
        return { ok: true, data: { definitionId, name: defName, notes: check.notes, reading: definitionReading(parseDefinition(body)) } };
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
