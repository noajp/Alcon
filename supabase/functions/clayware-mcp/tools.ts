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
  "moveElement", "writeFile", "writeInitiativeDefinition", "claimElement", "releaseElement",
]);
// Writes that overwrite what was there — a client should confirm these the
// way it confirms a delete.
const OVERWRITES = new Set([
  "updateElement", "updateSubelement", "updateObject", "updateInitiative", "updateIntent",
  "setElementLabels", "bulkUpdateElements", "moveElement", "writeFile", "writeInitiativeDefinition",
]);

function toMcp(def: AgentToolDef): McpTool {
  const readOnly = def.effect === "read";
  return {
    name: def.name,
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
