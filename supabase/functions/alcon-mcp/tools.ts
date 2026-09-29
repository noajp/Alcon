import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { BOARD_TOOLS, runBoardTool, type BoardActor, type ToolDef } from "../_shared/boardTools.ts";
import { STRATEGY_TOOLS, runStrategyTool } from "../_shared/strategyTools.ts";
import type { McpTool, ToolHost } from "./protocol.ts";

// What an external AI may do through MCP. Reads, plus the writes a person
// delegates day to day: create and update Elements, comment, assign, label,
// and tick subelements. Deletes, bulk writes, moving between Objects and
// Object edits stay in the app, where the person sees what they touch.

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

function toMcp(def: ToolDef): McpTool {
  const readOnly = READ.has(def.name);
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.input_schema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly || IDEMPOTENT.has(def.name),
      openWorldHint: false,
    },
  };
}

export function mcpTools(): McpTool[] {
  const byName = new Map([...BOARD_TOOLS, ...STRATEGY_TOOLS].map((t) => [t.name, t]));
  return [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS].map((name) => {
    const def = byName.get(name);
    if (!def) throw new Error(`MCP tool ${name} has no definition`);
    return toMcp(def);
  });
}

export function mcpHost(supabase: SupabaseClient, actor: BoardActor): ToolHost {
  return {
    tools: mcpTools(),
    call: (name, args) =>
      STRATEGY_NAMES.has(name)
        ? runStrategyTool(supabase, name, args)
        : runBoardTool(supabase, name, args, actor),
  };
}
