import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveElementId, type ToolDef, type ToolResult } from "./boardTools.ts";

// Dependencies — "this one waits for that one" — between Elements
// (element_edges, edge_type 'depends_on': to_element waits for from_element,
// the tie in attributes.kind) and between Objects (object_dependencies:
// blocked_object_id waits for blocker_object_id). The same rows the
// Timeline draws and the Element / Object panels edit, so an AI can lay
// out a schedule the way a person drags one.

/** Which ends the dependency ties: fs = the waiting one starts after the
 *  other finishes (the usual), ss = starts together, ff = finishes
 *  together, sf = finishes after the other starts. Same as web
 *  Function/shared/objectDependencyModel.ts. */
export const DEPENDENCY_KINDS = ["fs", "ss", "ff", "sf"] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How far a loop check follows the chain before giving up on it. */
const MAX_DEPTH = 200;

const TARGET = {
  type: "string",
  enum: ["element", "object"],
  description: "Element どうしの依存か、Object どうしの依存か",
};

export const DEPENDENCY_TOOLS: ToolDef[] = [
  {
    name: "listDependencies",
    description: "Element か Object の依存関係を返す。waitsFor はこれが待っている相手、blocks はこれを待っている相手。それぞれ名前・日付・つなぐ端（kind）と、日付が順番に反していれば conflict を付ける。",
    input_schema: {
      type: "object",
      properties: {
        target: TARGET,
        id: { type: "string", description: "Element id（UUID または ELE-NNN）か Object UUID" },
      },
      required: ["target", "id"],
      additionalProperties: false,
    },
  },
  {
    name: "addDependency",
    description: "waitingId が blockerId を待つ、という依存を足す。Timeline にはこの2本の帯をつなぐ線が引かれる。同じ組がすでにあれば kind だけを合わせる。輪になる依存は作らない。",
    input_schema: {
      type: "object",
      properties: {
        target: TARGET,
        blockerId: { type: "string", description: "先に進むほう（待たれるほう）" },
        waitingId: { type: "string", description: "待つほう" },
        kind: { type: "string", enum: [...DEPENDENCY_KINDS], description: "つなぐ端。fs（終わったら始める、既定）/ ss（一緒に始める）/ ff（一緒に終える）/ sf（始まったら終える）" },
      },
      required: ["target", "blockerId", "waitingId"],
      additionalProperties: false,
    },
  },
  {
    name: "removeDependency",
    description: "waitingId が blockerId を待つ、という依存を外す。",
    input_schema: {
      type: "object",
      properties: {
        target: TARGET,
        blockerId: { type: "string" },
        waitingId: { type: "string" },
      },
      required: ["target", "blockerId", "waitingId"],
      additionalProperties: false,
    },
  },
];

export const DEPENDENCY_TOOL_NAMES = new Set(DEPENDENCY_TOOLS.map((t) => t.name));

/** Pure. A valid kind, defaulting to fs; null when the value is not one. */
export function dependencyKindOf(v: unknown): DependencyKind | null {
  if (v === undefined || v === null || v === "") return "fs";
  return (DEPENDENCY_KINDS as readonly string[]).includes(String(v)) ? v as DependencyKind : null;
}

interface Span { start: string | null; due: string | null }

/** Pure. Whether the dates break the order the dependency asks for. Same
 *  rule as web Function/shared/objectDependencyModel.ts dependencyConflicts. */
export function dependencyConflicts(kind: DependencyKind, blocker: Span, waiting: Span): boolean {
  const a = (kind[0] === "s" ? blocker.start : blocker.due)?.slice(0, 10);
  const b = (kind[1] === "s" ? waiting.start : waiting.due)?.slice(0, 10);
  if (!a || !b) return false;
  return kind === "fs" ? b <= a : b < a;
}

/**
 * Whether making `waiting` wait for `blocker` closes a loop: true when
 * `blocker` already waits, directly or down the chain, for `waiting`.
 * `blockersOf` answers, for a set of ids, the ids each of them waits for.
 */
export async function dependencyWouldLoop(
  blocker: string, waiting: string, blockersOf: (ids: string[]) => Promise<string[]>,
): Promise<boolean> {
  if (blocker === waiting) return true;
  const seen = new Set<string>([blocker]);
  let frontier = [blocker];
  for (let depth = 0; frontier.length > 0 && depth < MAX_DEPTH; depth++) {
    const next: string[] = [];
    for (const id of await blockersOf(frontier)) {
      if (id === waiting) return true;
      if (!seen.has(id)) { seen.add(id); next.push(id); }
    }
    frontier = next;
  }
  return false;
}

async function resolveTarget(db: SupabaseClient, target: string, raw: unknown): Promise<string | null> {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (target === "element") return await resolveElementId(db, value);
  return UUID_RE.test(value) ? value : null;
}

export async function runDependencyTool(db: SupabaseClient, name: string, input: Record<string, unknown>): Promise<ToolResult> {
  const target = String(input.target ?? "");
  if (target !== "element" && target !== "object") return { ok: false, error: "target must be element or object" };
  const isElement = target === "element";

  if (name === "listDependencies") {
    const id = await resolveTarget(db, target, input.id);
    if (!id) return { ok: false, error: `${target} not found` };
    return isElement ? await listElementDependencies(db, id) : await listObjectDependencies(db, id);
  }

  const blocker = await resolveTarget(db, target, input.blockerId);
  const waiting = await resolveTarget(db, target, input.waitingId);
  if (!blocker) return { ok: false, error: `blockerId: ${target} not found` };
  if (!waiting) return { ok: false, error: `waitingId: ${target} not found` };

  if (name === "removeDependency") {
    const { data, error } = isElement
      ? await db.from("element_edges").delete().eq("from_element", blocker).eq("to_element", waiting).eq("edge_type", "depends_on").select("id")
      : await db.from("object_dependencies").delete().eq("blocker_object_id", blocker).eq("blocked_object_id", waiting).select("id");
    if (error) return { ok: false, error: error.message };
    return { ok: true, data: { removed: (data ?? []).length }, meta: { rows: (data ?? []).length } };
  }

  if (name !== "addDependency") return { ok: false, error: `Unknown tool: ${name}` };
  const kind = dependencyKindOf(input.kind);
  if (!kind) return { ok: false, error: `kind must be one of ${DEPENDENCY_KINDS.join(" / ")}` };

  const existing = isElement
    ? await db.from("element_edges").select("id, attributes").eq("from_element", blocker).eq("to_element", waiting).eq("edge_type", "depends_on").limit(1)
    : await db.from("object_dependencies").select("id, kind").eq("blocker_object_id", blocker).eq("blocked_object_id", waiting).limit(1);
  if (existing.error) return { ok: false, error: existing.error.message };
  const found = (existing.data ?? [])[0] as { id: string; kind?: string | null; attributes?: Record<string, unknown> | null } | undefined;
  if (found) {
    // Already there: the same pair with another tie changes the tie, as the
    // Timeline's dependency menu does.
    const current = dependencyKindOf(isElement ? found.attributes?.kind : found.kind) ?? "fs";
    if (current === kind) return { ok: true, data: { id: found.id, kind, alreadyThere: true }, meta: { rows: 0 } };
    const { data, error } = isElement
      ? await db.from("element_edges").update({ attributes: { ...(found.attributes ?? {}), kind } }).eq("id", found.id).select("id")
      : await db.from("object_dependencies").update({ kind }).eq("id", found.id).select("id");
    if (error) return { ok: false, error: error.message };
    if (!data || data.length === 0) return { ok: false, error: `この ${target} を変える権限がありません` };
    return { ok: true, data: { id: found.id, kind, changedFrom: current }, meta: { rows: 1 } };
  }

  const blockersOf = isElement
    ? async (ids: string[]) => {
      const { data, error } = await db.from("element_edges").select("from_element").in("to_element", ids).eq("edge_type", "depends_on");
      if (error) throw error;
      return (data ?? []).map((r: { from_element: string }) => r.from_element);
    }
    : async (ids: string[]) => {
      const { data, error } = await db.from("object_dependencies").select("blocker_object_id").in("blocked_object_id", ids);
      if (error) throw error;
      return (data ?? []).map((r: { blocker_object_id: string }) => r.blocker_object_id);
    };
  if (await dependencyWouldLoop(blocker, waiting, blockersOf)) {
    return { ok: false, error: "この依存を足すと輪になります（待っている相手が、すでにこちらを待っています）" };
  }

  const { data, error } = isElement
    ? await db.from("element_edges").insert({ from_element: blocker, to_element: waiting, edge_type: "depends_on", attributes: { kind } }).select("id")
    : await db.from("object_dependencies").insert({ blocker_object_id: blocker, blocked_object_id: waiting, kind }).select("id");
  if (error) return { ok: false, error: error.message };
  // RLS refuses by returning nothing: say so instead of pretending it landed.
  if (!data || data.length === 0) return { ok: false, error: `この ${target} を変える権限がありません` };
  return { ok: true, data: { id: data[0].id, kind }, meta: { rows: 1 } };
}

type ElementRow = { id: string; display_id: string | null; title: string; status: string; start_date: string | null; due_date: string | null };
type ObjectRow = { id: string; name: string; start_date: string | null; due_date: string | null };

async function listElementDependencies(db: SupabaseClient, id: string): Promise<ToolResult> {
  const { data: edges, error } = await db.from("element_edges")
    .select("id, from_element, to_element, attributes").eq("edge_type", "depends_on")
    .or(`from_element.eq.${id},to_element.eq.${id}`);
  if (error) return { ok: false, error: error.message };
  const rows = (edges ?? []) as { id: string; from_element: string; to_element: string; attributes: { kind?: string } | null }[];
  const ids = [...new Set([id, ...rows.flatMap((e) => [e.from_element, e.to_element])])];
  const { data: els, error: elError } = await db.from("elements").select("id, display_id, title, status, start_date, due_date").in("id", ids);
  if (elError) return { ok: false, error: elError.message };
  const byId = new Map(((els ?? []) as ElementRow[]).map((e) => [e.id, e]));
  const self = byId.get(id);
  const span = (e?: ElementRow) => ({ start: e?.start_date ?? null, due: e?.due_date ?? null });
  const describe = (edge: typeof rows[number], other: string, blocker: ElementRow | undefined, waiting: ElementRow | undefined) => {
    const kind = dependencyKindOf(edge.attributes?.kind) ?? "fs";
    const o = byId.get(other);
    return {
      id: other, display_id: o?.display_id ?? null, title: o?.title ?? null, status: o?.status ?? null,
      start_date: o?.start_date ?? null, due_date: o?.due_date ?? null, kind,
      conflict: dependencyConflicts(kind, span(blocker), span(waiting)),
    };
  };
  return {
    ok: true,
    data: {
      waitsFor: rows.filter((e) => e.to_element === id).map((e) => describe(e, e.from_element, byId.get(e.from_element), self)),
      blocks: rows.filter((e) => e.from_element === id).map((e) => describe(e, e.to_element, self, byId.get(e.to_element))),
    },
    meta: { rows: rows.length },
  };
}

async function listObjectDependencies(db: SupabaseClient, id: string): Promise<ToolResult> {
  const { data: links, error } = await db.from("object_dependencies")
    .select("id, blocker_object_id, blocked_object_id, kind")
    .or(`blocker_object_id.eq.${id},blocked_object_id.eq.${id}`);
  if (error) return { ok: false, error: error.message };
  const rows = (links ?? []) as { id: string; blocker_object_id: string; blocked_object_id: string; kind: string | null }[];
  const ids = [...new Set([id, ...rows.flatMap((l) => [l.blocker_object_id, l.blocked_object_id])])];
  const { data: objs, error: objError } = await db.from("objects").select("id, name, start_date, due_date").in("id", ids);
  if (objError) return { ok: false, error: objError.message };
  const byId = new Map(((objs ?? []) as ObjectRow[]).map((o) => [o.id, o]));
  const span = (o?: ObjectRow) => ({ start: o?.start_date ?? null, due: o?.due_date ?? null });
  const describe = (link: typeof rows[number], other: string) => {
    const kind = dependencyKindOf(link.kind) ?? "fs";
    const o = byId.get(other);
    return {
      id: other, name: o?.name ?? null, start_date: o?.start_date ?? null, due_date: o?.due_date ?? null, kind,
      conflict: dependencyConflicts(kind, span(byId.get(link.blocker_object_id)), span(byId.get(link.blocked_object_id))),
    };
  };
  return {
    ok: true,
    data: {
      waitsFor: rows.filter((l) => l.blocked_object_id === id).map((l) => describe(l, l.blocker_object_id)),
      blocks: rows.filter((l) => l.blocker_object_id === id).map((l) => describe(l, l.blocked_object_id)),
    },
    meta: { rows: rows.length },
  };
}
