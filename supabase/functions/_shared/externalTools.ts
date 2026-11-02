import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOARD_TOOLS, runBoardTool, type BoardActor, type ToolDef, type ToolResult } from "./boardTools.ts";
import { STRATEGY_TOOLS, runStrategyTool } from "./strategyTools.ts";
import { AGENT_REPORT_TOOLS, isAgentReportTool, runAgentReportTool } from "./agentReportTools.ts";
import type { CallerAccess } from "./callerAuth.ts";

// What a caller outside the app may do — through MCP (alcon-mcp) or REST
// (alcon-api); both read this one list. Reads, plus the writes a person
// delegates day to day: create and update Elements, comment, assign, label,
// and tick subelements — and how an agent reports on the Element it works:
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
 * refused here, whatever the entry in front of it checked.
 */
export async function runExternalTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  actor: BoardActor,
  access: CallerAccess = "read_write",
): Promise<ToolResult> {
  const offered = externalToolDefs(access).some((t) => t.name === name);
  if (!offered) return { ok: false, error: `Tool ${name} is not available to this connection` };
  if (STRATEGY_NAMES.has(name)) return await runStrategyTool(supabase, name, args);
  if (isAgentReportTool(name)) return await runAgentReportTool(supabase, name, args, actor);
  return await runBoardTool(supabase, name, args, actor);
}
