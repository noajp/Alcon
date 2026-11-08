import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOARD_TOOLS, errorMessage, runBoardTool, type BoardActor, type ToolDef, type ToolResult } from "./boardTools.ts";
import { STRATEGY_TOOLS, STRATEGY_WRITE_TOOLS, runStrategyTool, runStrategyWriteTool } from "./strategyTools.ts";
import { MEASURE_TOOLS, runMeasureTool } from "./measureTools.ts";
import { WIDGET_TOOLS, runWidgetTool } from "./widgetTools.ts";
import { BATCH_TOOLS, runBatchTool } from "./batchTools.ts";
import { FILE_TOOLS, runFileTool } from "./fileTools.ts";
import { HARNESS_TOOLS, runHarnessTool } from "./harnessTools.ts";
import { MEMORY_TOOLS, runMemoryTool } from "./memoryTools.ts";
import type { RunToolDef } from "./toolLoading.ts";

// Every operation Alcon's AI can perform inside Alcon, in one list, with one
// executor. Each entry — the AI panel, a conversation on a Strategy, an
// Element's run (automations start those) — takes its tools from here through
// its policy (ENTRY_POLICIES): the entries differ in the context they give
// and the permission they grant, never in which code does the work. A tool
// added here reaches every entry its effect is allowed in.
//
// Every call runs with the caller's JWT, so RLS decides what each call may
// see and change, exactly as for that person in the app.

export type ToolArea = "strategy" | "execution" | "table" | "board" | "files" | "harness" | "memory";
/** read: changes nothing. write: creates or changes. delete: removes. */
export type ToolEffect = "read" | "write" | "delete";

export interface CatalogTool extends ToolDef {
  area: ToolArea;
  effect: ToolEffect;
}

const DELETES = new Set(["deleteElement", "deleteSubelement", "deleteObject", "bulkDeleteElements", "removeIntent", "deleteInitiative"]);
const READS = new Set([
  "listMyDomains", "listObjects", "listElements", "getElement", "findByText", "getProgress", "getRecentActivity", "listWorkers",
  "listInitiatives", "getInitiative", "getInitiativeExecution", "listFiles", "readFile", "listHarnesses", "readHarness",
  "recall_memory",
]);

function entries(defs: ToolDef[], area: ToolArea): CatalogTool[] {
  return defs.map((d) => ({ ...d, area, effect: READS.has(d.name) ? "read" : DELETES.has(d.name) ? "delete" : "write" }));
}

export const CATALOG: CatalogTool[] = [
  ...entries(STRATEGY_TOOLS, "strategy"),
  ...entries(STRATEGY_WRITE_TOOLS, "strategy"),
  ...entries(MEASURE_TOOLS as ToolDef[], "strategy"),
  ...entries(BOARD_TOOLS, "execution"),
  ...entries(BATCH_TOOLS, "execution"),
  ...entries(FILE_TOOLS, "files"),
  ...entries(HARNESS_TOOLS, "harness"),
  // Memory: recall reads in every entry; remember writes durable at a
  // person's word, so it is offered where a conversation can carry
  // that word (the panel, a Strategy conversation) — never to an
  // Element's run, whose learning enters as episodes at its finish.
  ...entries(MEMORY_TOOLS, "memory"),
  ...entries((WIDGET_TOOLS as ToolDef[]).filter((t) => t.name === "tableData"), "table"),
  ...entries((WIDGET_TOOLS as ToolDef[]).filter((t) => t.name === "widgetBoard"), "board"),
];

const BY_NAME = new Map(CATALOG.map((t) => [t.name, t]));

export function catalogTool(name: string): CatalogTool | undefined {
  return BY_NAME.get(name);
}

export function isCatalogTool(name: string): boolean {
  return BY_NAME.has(name);
}

/** Tools that take an action argument; each call's effect is its action's. */
const ACTION_TOOLS = new Set(["tableData", "widgetBoard", "campaignMeasure"]);
const READ_ACTIONS = new Set(["list", "get", "campaigns"]);

/** Pure. What one call does. A multi-action tool's call is a read, a write or
 *  a delete by its action; an unknown action counts as a delete. */
export function effectOfCall(tool: CatalogTool, input: Record<string, unknown>): ToolEffect {
  if (!ACTION_TOOLS.has(tool.name)) return tool.effect;
  const action = typeof input.action === "string" ? input.action : "";
  if (READ_ACTIONS.has(action)) return "read";
  if (action === "create" || action === "update") return "write";
  return "delete";
}

// ── Entries ─────────────────────────────────────────────────────────────────

export type Entry = "panel" | "conversation" | "element";

/** allow: runs now. approve: runs once the person who started the run approves
 *  exactly this call. deny: the entry may not run it. */
export type Decision = "allow" | "approve" | "deny";

export interface EntryPolicy {
  /** Effects allowed in every area. */
  effects: ToolEffect[];
  /** Areas where writes are allowed, when "write" is not in effects. */
  writeAreas?: ToolArea[];
  /** Areas where a write runs only after approval. */
  approveAreas?: ToolArea[];
  /** Further tools allowed by name. */
  also?: string[];
  /** Loaded up front; the rest load when the model searches for them. */
  core: string[];
}

const READ_CORE = ["listInitiatives", "getInitiative", "listObjects", "listElements", "getElement", "findByText", "listFiles", "readFile", "listHarnesses"];

export const ENTRY_POLICIES: Record<Entry, EntryPolicy> = {
  // The AI panel: the person at the keyboard asked, and confirms deletes in the chat.
  panel: {
    effects: ["read", "write", "delete"],
    core: [...READ_CORE, "createInitiative", "createElements", "updateElement", "writeFile"],
  },
  // A conversation settles a Strategy's intent: it reads anything and writes
  // the Strategy's record and files. Breaking it down into Objects and
  // Elements is the Planner's (hand_to_planner).
  conversation: {
    effects: ["read"],
    writeAreas: ["strategy", "files", "memory"],
    also: ["removeIntent"],
    core: [...READ_CORE, "getInitiativeExecution", "updateInitiative", "createInitiative", "addIntent", "updateIntent", "removeIntent", "writeInitiativeDefinition", "readHarness"],
  },
  // An Element's run (started by a person or an automation, possibly on
  // input from outside): it reads anything and does the work on the board
  // and in files. A change to a Strategy — the purpose, the success
  // conditions the verifier checks, the harness the run follows — waits for
  // the person's approval. It never removes anything, and Tables and boards
  // it changes only through its own save_records.
  element: {
    effects: ["read"],
    writeAreas: ["execution", "files"],
    approveAreas: ["strategy"],
    core: [...READ_CORE.filter((n) => n !== "listHarnesses"), "createElement", "updateElement", "addElementComment", "createSubelement", "toggleSubelementComplete"],
  },
};

/** Pure. What the entry does with one call. */
export function decideCall(entry: Entry, tool: CatalogTool, input: Record<string, unknown>): Decision {
  const p = ENTRY_POLICIES[entry];
  if (p.also?.includes(tool.name)) return "allow";
  const effect = effectOfCall(tool, input);
  if (p.effects.includes(effect)) return "allow";
  if (effect === "write" && p.writeAreas?.includes(tool.area)) return "allow";
  if (effect === "write" && p.approveAreas?.includes(tool.area)) return "approve";
  return "deny";
}

/** Pure. True when some call of the tool may be allowed or approved in the
 *  entry — the tools the entry offers. A multi-action tool is offered for its
 *  reads; its writes and deletes are decided call by call. */
export function offeredIn(entry: Entry, tool: CatalogTool): boolean {
  if (ACTION_TOOLS.has(tool.name)) return decideCall(entry, tool, { action: "list" }) !== "deny";
  return decideCall(entry, tool, {}) !== "deny";
}

/** Pure. True when a call of the tool may have to wait for approval in the entry. */
export function mayNeedApproval(entry: Entry, name: string): boolean {
  const tool = BY_NAME.get(name);
  return !!tool && tool.effect !== "read" && (ENTRY_POLICIES[entry].approveAreas?.includes(tool.area) ?? false);
}

/** Pure. The catalog tools an entry offers, its core loaded and the rest deferred. */
export function toolsFor(entry: Entry): (RunToolDef & { area: ToolArea; effect: ToolEffect })[] {
  const core = new Set(ENTRY_POLICIES[entry].core);
  const offered = CATALOG.filter((t) => offeredIn(entry, t));
  return [...offered.filter((t) => core.has(t.name)), ...offered.filter((t) => !core.has(t.name)).map((t) => ({ ...t, defer: true }))];
}

/** Pure. One line for an approval card or a log: the operation and what it is about. */
export function catalogOperation(name: string, input: Record<string, unknown>): string {
  const about = ["name", "title", "body"].map((k) => input[k]).find((v) => typeof v === "string" && v.trim()) as string | undefined;
  const action = typeof input.action === "string" ? ` ${input.action}` : "";
  return `${name}${action}${about ? `「${about.trim().replace(/\s+/g, " ").slice(0, 60)}」` : ""}`;
}

/** Pure. A tool's one line: its description up to the first sentence's end. */
export function summaryOf(description: string): string {
  const m = /^(.+?(?:[。！？]|[.!?](?=\s|$)))/.exec(description.trim());
  return (m ? m[1] : description.trim()).slice(0, 120);
}

/** Pure. The names and one-line descriptions of the deferred tools, for the
 *  system prompt: the model knows what exists and loads a tool by searching
 *  for its name. */
export function catalogIndex(tools: (RunToolDef & { area?: ToolArea })[]): string {
  const deferred = tools.filter((t) => t.defer);
  if (!deferred.length) return "";
  const label: Record<ToolArea, string> = { strategy: "Strategy", execution: "Execution", table: "Table", board: "ボード", files: "ファイル", harness: "ハーネス", memory: "記憶" };
  const groups = new Map<string, string[]>();
  for (const t of deferred) {
    const g = t.area ? label[t.area] : "その他";
    groups.set(g, [...(groups.get(g) ?? []), `- ${t.name}: ${summaryOf(t.description)}`]);
  }
  return `# ほかに使える道具（使うときは道具の検索で名前を探すと読み込まれる）\n${[...groups].map(([g, lines]) => `## ${g}\n${lines.join("\n")}`).join("\n")}`;
}

// ── Executor ────────────────────────────────────────────────────────────────

/** Pure. The refusal a denied catalog call is answered with — one wording,
 *  whether the refusal comes from the approval gate (a deny verdict is
 *  answered before dispatch) or from the executor's own recheck below. */
export function catalogDenyRefusal(name: string, input: Record<string, unknown>): string {
  return `この操作（${catalogOperation(name, input)}）はここからは実行できません。必要なら人に頼んでください。`;
}

/**
 * Runs one catalog tool with the caller's client, under the entry's policy:
 * a call the entry may not run is refused, and one that needs approval runs
 * only when `approved` says the person approved this call. Never throws.
 */
export async function runCatalogTool(
  db: SupabaseClient, name: string, input: Record<string, unknown>, actor: BoardActor,
  under: { entry: Entry; approved?: boolean },
): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  const decision = decideCall(under.entry, tool, input);
  if (decision === "deny") return { ok: false, error: catalogDenyRefusal(name, input) };
  if (decision === "approve" && !under.approved) return { ok: false, error: `この操作（${catalogOperation(name, input)}）は承認を受けてから実行されます。` };
  try {
    if (name === "campaignMeasure") return await runMeasureTool(db, input);
    if (name === "createElements") return await runBatchTool(db, input, actor);
    if (tool.area === "memory") return await runMemoryTool(db, name, input, actor);
    if (name === "tableData" || name === "widgetBoard") return await runWidgetTool(db, name, input);
    switch (tool.area) {
      case "strategy":
        return tool.effect === "read" ? await runStrategyTool(db, name, input) : await runStrategyWriteTool(db, name, input);
      case "files":
        return await runFileTool(db, name, input);
      case "harness":
        return await runHarnessTool(db, name, input);
      default:
        return await runBoardTool(db, name, input, actor);
    }
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
