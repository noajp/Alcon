import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOARD_TOOLS, errorMessage, runBoardTool, type BoardActor, type ToolDef, type ToolResult } from "./boardTools.ts";
import { STRATEGY_TOOLS, runStrategyTool } from "./strategyTools.ts";
import { AGENT_REPORT_TOOLS, isAgentReportTool, runAgentReportTool, type CallerNotifier, type ReportBinding } from "./agentReportTools.ts";
import type { CallerAccess } from "./callerAuth.ts";
import { CATALOG, catalogTool, effectOfCall, offeredIn, runCatalogTool, type ToolEffect } from "./catalog.ts";
import { WIDGET_TOOLS, runWidgetTool } from "./widgetTools.ts";
import { GUIDE_TOOL, runGuideTool, steeredDescription, steerRefusal } from "./claywareGuide.ts";

// What a caller outside the app may do — through MCP (clayware-mcp) or REST
// (clayware-api); both read this one list. Reads, plus the writes a person
// delegates day to day: create and update Elements, comment, assign, label,
// and add or complete Sub-elements — and how an agent reports on the Element it works:
// take and return the lease, log progress, close with an outcome
// (agentReportTools.ts). Deletes, bulk writes, moving between Objects and
// Object edits stay in the app, where the person sees what they touch.
// A read-only personal access token reaches the reads alone.

export const EXTERNAL_READ_TOOLS = [
  "listMyDomains",
  "listObjects",
  "listElements",
  "getElement",
  "findByText",
  "getProgress",
  "getRecentActivity",
  "listWorkers",
  "listInitiatives",
  "getInitiative",
] as const;

export const EXTERNAL_WRITE_TOOLS = [
  "createElement",
  "updateElement",
  "addElementComment",
  "addElementAssignee",
  "setElementLabels",
  "createSubelement",
  "toggleSubelementComplete",
  "claimElement",
  "releaseElement",
  "logProgress",
  "reportOutcome",
] as const;

export type ExternalTool = (typeof EXTERNAL_READ_TOOLS)[number] | (typeof EXTERNAL_WRITE_TOOLS)[number];

const STRATEGY_NAMES = new Set(STRATEGY_TOOLS.map((t) => t.name));
const READ = new Set<string>(EXTERNAL_READ_TOOLS);

export function isReadTool(name: string): boolean {
  return READ.has(name);
}

/** The tool definitions a caller with `access` is offered, reads first. */
export function externalToolDefs(access: CallerAccess = "read_write"): ToolDef[] {
  const byName = new Map([...BOARD_TOOLS, ...STRATEGY_TOOLS, ...AGENT_REPORT_TOOLS].map((t) => [t.name, t]));
  const names: readonly string[] = access === "read_write"
    ? [...EXTERNAL_READ_TOOLS, ...EXTERNAL_WRITE_TOOLS]
    : EXTERNAL_READ_TOOLS;
  return names.map((name) => {
    const def = byName.get(name);
    if (!def) throw new Error(`External tool ${name} has no definition`);
    return def;
  });
}

/**
 * Runs one tool for an outside caller. A tool not offered at `access` is
 * refused here, whatever the entry in front of it checked. `notify` tells
 * the connecting person when their agent closes work (agentReportTools.ts).
 * `binding`, when the dispatching driver runs work on a known Element (a
 * run's agent_runs.element_id), makes the report tools act on that id
 * directly instead of re-resolving the caller's string.
 */
export async function runExternalTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  actor: BoardActor,
  access: CallerAccess = "read_write",
  notify?: CallerNotifier,
  binding?: ReportBinding,
): Promise<ToolResult> {
  const offered = externalToolDefs(access).some((t) => t.name === name);
  if (!offered) return { ok: false, error: `Tool ${name} is not available to this connection` };
  const steer = await steerRefusal(supabase, name, args).catch(() => null);
  if (steer) return { ok: false, error: steer };
  if (STRATEGY_NAMES.has(name)) return await runStrategyTool(supabase, name, args);
  if (isAgentReportTool(name)) return await runAgentReportTool(supabase, name, args, actor, notify, binding);
  return await runBoardTool(supabase, name, args, actor);
}

// ── An outside AI working as the person (clayware-mcp) ──────────────────────
//
// MCP reaches what Clayware's own AI reaches from the panel: every catalog
// tool the "external" entry offers (catalog.ts), the Table tool, and the
// lease and report tools above — and the guide to how Clayware works
// (claywareGuide.ts), which also steers the calls that cut across it. The outside model is the brain, so no
// Clayware model is called and nothing is metered. The REST API keeps the
// day-to-day list above: each of its tools is a route of its own.

const TABLE_TOOL = (WIDGET_TOOLS as ToolDef[]).find((t) => t.name === "tableData")!;
const ACTION_TOOLS = new Set(["tableData", "widgetBoard", "campaignMeasure"]);

export interface AgentToolDef extends ToolDef {
  /** What the tool's calls can do at most: an action tool counts as its worst action. */
  effect: ToolEffect;
}

/** Pure. What one call of an outside agent's tool does. */
export function agentCallEffect(name: string, args: Record<string, unknown>): ToolEffect | null {
  if (name === GUIDE_TOOL.name) return "read";
  if (name === TABLE_TOOL.name) {
    const action = typeof args.action === "string" ? args.action : "";
    return action === "list" || action === "get" ? "read" : action === "create" || action === "update" ? "write" : "delete";
  }
  if (isAgentReportTool(name)) return "write";
  const tool = catalogTool(name);
  return tool ? effectOfCall(tool, args) : null;
}

/** The tools an outside agent with `access` is offered: reads, then writes, then deletes. */
export function agentToolDefs(access: CallerAccess = "read_write"): AgentToolDef[] {
  const effectOf = (t: ToolDef & { effect?: ToolEffect }): ToolEffect =>
    ACTION_TOOLS.has(t.name) ? "delete" : t.effect ?? "write";
  const all: AgentToolDef[] = [
    { ...GUIDE_TOOL, effect: "read" },
    ...CATALOG.filter((t) => offeredIn("external", t)).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, effect: effectOf(t) })),
    { ...TABLE_TOOL, effect: "delete" },
    ...AGENT_REPORT_TOOLS.map((t) => ({ ...t, effect: "write" as const })),
  ];
  // A read-only connection is offered the reads, and the action tools for their reads.
  const offered = access === "read_write" ? all : all.filter((t) => t.effect === "read" || ACTION_TOOLS.has(t.name));
  const rank: Record<ToolEffect, number> = { read: 0, write: 1, delete: 2 };
  return offered
    .map((t) => ({ ...t, description: steeredDescription(t.name, t.description) }))
    .sort((a, b) => rank[a.effect] - rank[b.effect]);
}

/**
 * Runs one tool for an outside agent. A tool not offered at `access` is
 * refused, and so is a read-only connection's call whose action writes.
 */
export async function runAgentTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  actor: BoardActor,
  access: CallerAccess = "read_write",
  notify?: CallerNotifier,
): Promise<ToolResult> {
  if (!agentToolDefs(access).some((t) => t.name === name)) return { ok: false, error: `Tool ${name} is not available to this connection` };
  if (access !== "read_write" && agentCallEffect(name, args) !== "read") {
    return { ok: false, error: "This connection is read-only" };
  }
  if (name === GUIDE_TOOL.name) return await runGuideTool(supabase, args);
  // A call that cuts across how Clayware works is answered with why.
  const steer = await steerRefusal(supabase, name, args).catch(() => null);
  if (steer) return { ok: false, error: steer };
  if (isAgentReportTool(name)) return await runAgentReportTool(supabase, name, args, actor, notify);
  if (name === TABLE_TOOL.name) {
    try {
      return await runWidgetTool(supabase, name, args);
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }
  return await runCatalogTool(supabase, name, args, actor, { entry: "external" });
}
