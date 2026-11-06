import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOARD_TOOLS, errorMessage, runBoardTool, type BoardActor, type ToolDef, type ToolResult } from "./boardTools.ts";
import { STRATEGY_TOOLS, STRATEGY_WRITE_TOOLS, runStrategyTool, runStrategyWriteTool } from "./strategyTools.ts";
import { MEASURE_TOOLS, runMeasureTool } from "./measureTools.ts";
import { WIDGET_TOOLS, runWidgetTool } from "./widgetTools.ts";
import { BATCH_TOOLS, runBatchTool } from "./batchTools.ts";
import { FILE_TOOLS, runFileTool } from "./fileTools.ts";
import { HARNESS_TOOLS, runHarnessTool } from "./harnessTools.ts";
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

export type ToolArea = "strategy" | "execution" | "table" | "board" | "files" | "harness";
/** read: changes nothing. write: creates or changes. delete: removes. */
export type ToolEffect = "read" | "write" | "delete";

export interface CatalogTool extends ToolDef {
  area: ToolArea;
  effect: ToolEffect;
}

const DELETES = new Set(["deleteElement", "deleteSubelement", "deleteObject", "bulkDeleteElements", "removeIntent", "deleteInitiative"]);
const READS = new Set([
  "listMyDomains", "listObjects", "listElements", "getElement", "findByText", "getProgress", "getRecentActivity", "listWorkers",
  "listInitiatives", "getInitiative", "listFiles", "readFile", "listHarnesses", "readHarness",
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

// ── Entries ─────────────────────────────────────────────────────────────────

export type Entry = "panel" | "conversation" | "element";

export interface EntryPolicy {
  /** Effects allowed in every area. */
  effects: ToolEffect[];
  /** Areas where writes are allowed, when "write" is not in effects. */
  writeAreas?: ToolArea[];
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
    writeAreas: ["strategy", "files"],
    also: ["removeIntent"],
    core: [...READ_CORE, "updateInitiative", "createInitiative", "addIntent", "updateIntent", "removeIntent", "writeInitiativeDefinition", "readHarness"],
  },
  // An Element's run (started by a person or an automation): reads and
  // writes; nothing that removes.
  element: {
    effects: ["read", "write"],
    core: [...READ_CORE.filter((n) => n !== "listHarnesses"), "createElement", "updateElement", "addElementComment", "createSubelement", "toggleSubelementComplete"],
  },
};

/** Pure. True when the entry's policy allows the tool. */
export function allowedIn(entry: Entry, tool: CatalogTool): boolean {
  const p = ENTRY_POLICIES[entry];
  if (p.effects.includes(tool.effect)) return true;
  if (tool.effect === "write" && p.writeAreas?.includes(tool.area)) return true;
  return p.also?.includes(tool.name) ?? false;
}

/** Pure. The catalog tools an entry offers, its core loaded and the rest deferred. */
export function toolsFor(entry: Entry): (RunToolDef & { area: ToolArea; effect: ToolEffect })[] {
  const core = new Set(ENTRY_POLICIES[entry].core);
  const allowed = CATALOG.filter((t) => allowedIn(entry, t));
  return [...allowed.filter((t) => core.has(t.name)), ...allowed.filter((t) => !core.has(t.name)).map((t) => ({ ...t, defer: true }))];
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
  const label: Record<ToolArea, string> = { strategy: "Strategy", execution: "Execution", table: "Table", board: "ボード", files: "ファイル", harness: "ハーネス" };
  const groups = new Map<string, string[]>();
  for (const t of deferred) {
    const g = t.area ? label[t.area] : "その他";
    groups.set(g, [...(groups.get(g) ?? []), `- ${t.name}: ${summaryOf(t.description)}`]);
  }
  return `# ほかに使える道具（使うときは道具の検索で名前を探すと読み込まれる）\n${[...groups].map(([g, lines]) => `## ${g}\n${lines.join("\n")}`).join("\n")}`;
}

// ── Executor ────────────────────────────────────────────────────────────────

/** Runs one catalog tool with the caller's client. Never throws. */
export async function runCatalogTool(db: SupabaseClient, name: string, input: Record<string, unknown>, actor: BoardActor): Promise<ToolResult> {
  const tool = BY_NAME.get(name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  try {
    if (name === "campaignMeasure") return await runMeasureTool(db, input);
    if (name === "createElements") return await runBatchTool(db, input, actor);
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
