import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOARD_TOOLS, runBoardTool, type BoardActor, type ToolDef } from "../_shared/boardTools.ts";
import { STRATEGY_TOOLS, runStrategyTool } from "../_shared/strategyTools.ts";
import type { CallerAccess } from "../_shared/callerAuth.ts";
import type { McpTool, ToolHost } from "./protocol.ts";

// What an external AI may do through MCP. Reads, plus the writes a person
// delegates day to day: create and update Elements, comment, assign, label,
// and tick subelements. Deletes, bulk writes, moving between Objects and
// Object edits stay in the app, where the person sees what they touch.
// A read-only personal access token is offered the reads alone, so the
// allowlist in protocol.ts refuses every write before it reaches a tool.

export const MCP_READ_TOOLS = [
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

export const MCP_WRITE_TOOLS = [
  "createElement",
  "updateElement",
  "addElementComment",
  "addElementAssignee",
  "setElementLabels",
  "createSubelement",
  "toggleSubelementComplete",
] as const;

const STRATEGY_NAMES = new Set(STRATEGY_TOOLS.map((t) => t.name));
const READ = new Set<string>(MCP_READ_TOOLS);
// Writes that land the same state when repeated.
const IDEMPOTENT = new Set(["updateElement", "addElementAssignee", "setElementLabels"]);
// Writes that overwrite what was there (a title, a description, the whole
// label set) — a client should confirm these the way it confirms a delete.
const OVERWRITES = new Set(["updateElement", "setElementLabels"]);

function toMcp(def: ToolDef): McpTool {
  const readOnly = READ.has(def.name);
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.input_schema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: OVERWRITES.has(def.name),
      idempotentHint: readOnly || IDEMPOTENT.has(def.name),
      openWorldHint: false,
    },
  };
}

export function mcpTools(access: CallerAccess = "read_write"): McpTool[] {
  const byName = new Map([...BOARD_TOOLS, ...STRATEGY_TOOLS].map((t) => [t.name, t]));
  const names: readonly string[] = access === "read_write" ? [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS] : MCP_READ_TOOLS;
  return names.map((name) => {
    const def = byName.get(name);
    if (!def) throw new Error(`MCP tool ${name} has no definition`);
    return toMcp(def);
  });
}

export function mcpHost(supabase: SupabaseClient, actor: BoardActor, access: CallerAccess = "read_write"): ToolHost {
  const tools = mcpTools(access);
  const offered = new Set(tools.map((t) => t.name));
  return {
    tools,
    call: async (name, args) => {
      // protocol.ts already refuses tools that are not listed; this keeps a
      // read-only host read-only even if called directly.
      if (!offered.has(name)) return { ok: false, error: `Tool ${name} is not available to this connection` };
      return STRATEGY_NAMES.has(name)
        ? await runStrategyTool(supabase, name, args)
        : await runBoardTool(supabase, name, args, actor);
    },
  };
}
