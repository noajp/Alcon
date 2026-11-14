import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { BoardActor } from "../_shared/boardTools.ts";
import { agentToolDefs, runAgentTool, type AgentToolDef } from "../_shared/externalTools.ts";
import type { CallerAccess } from "../_shared/callerAuth.ts";
import type { CallerNotifier } from "../_shared/agentReportTools.ts";
import type { McpTool, ToolHost } from "./protocol.ts";

// The tools an external AI is offered over MCP: what Clayware's own AI
// reaches from the panel (_shared/externalTools.ts agentToolDefs), with
// MCP's hints. A read-only connection is offered the reads alone (and the
// action tools for their reads), and runAgentTool refuses its writes.

// Writes that land the same state when repeated.
const IDEMPOTENT = new Set([
  "updateElement", "updateSubelement", "updateObject", "updateInitiative", "updateIntent",
  "addElementAssignee", "removeElementAssignee", "setElementLabels", "linkElementToObject", "unlinkElementFromObject",
  "moveElement", "writeFile", "writeInitiativeDefinition", "updateHarness", "claimElement", "releaseElement",
]);
// Writes that overwrite what was there — a client should confirm these the
// way it confirms a delete.
const OVERWRITES = new Set([
  "updateElement", "updateSubelement", "updateObject", "updateInitiative", "updateIntent",
  "setElementLabels", "bulkUpdateElements", "moveElement", "writeFile", "writeInitiativeDefinition", "updateHarness",
]);

// Display titles for the tool list. Client directories (Claude, ChatGPT)
// require a human-readable title on every tool. Names that humanize badly
// get an explicit title here; the rest are derived from the tool name.
const TITLES: Record<string, string> = {
  getClaywareGuide: "Clayware guide",
  tableData: "Table data",
  widgetBoard: "Widget board",
  campaignMeasure: "Campaign measure",
  note_pending_capability: "Note a pending capability",
};

function toolTitle(name: string): string {
  const known = TITLES[name];
  if (known) return known;
  const words = name.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toMcp(def: AgentToolDef): McpTool {
  const readOnly = def.effect === "read";
  return {
    name: def.name,
    title: toolTitle(def.name),
    description: def.description,
    inputSchema: def.input_schema,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: def.effect === "delete" || OVERWRITES.has(def.name),
      idempotentHint: readOnly || IDEMPOTENT.has(def.name),
      openWorldHint: false,
    },
  };
}

export function mcpTools(access: CallerAccess = "read_write"): McpTool[] {
  return agentToolDefs(access).map(toMcp);
}

export function mcpHost(
  supabase: SupabaseClient,
  actor: BoardActor,
  access: CallerAccess = "read_write",
  notify?: CallerNotifier,
): ToolHost {
  return {
    tools: mcpTools(access),
    // protocol.ts already refuses tools that are not listed; runAgentTool
    // keeps a read-only host read-only even if called directly.
    call: (name, args) => runAgentTool(supabase, name, args, actor, access, notify),
  };
}
