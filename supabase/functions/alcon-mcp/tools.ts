import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { BoardActor, ToolDef } from "../_shared/boardTools.ts";
import {
  EXTERNAL_READ_TOOLS, EXTERNAL_WRITE_TOOLS, externalToolDefs, isReadTool, runExternalTool,
} from "../_shared/externalTools.ts";
import type { CallerAccess } from "../_shared/callerAuth.ts";
import type { McpTool, ToolHost } from "./protocol.ts";

// The tools an external AI is offered over MCP: the outside-caller allowlist
// in _shared/externalTools.ts (the REST API reads the same one), with MCP's
// hints. A read-only personal access token is offered the reads alone, so
// the allowlist in protocol.ts refuses every write before it reaches a tool.

export const MCP_READ_TOOLS = EXTERNAL_READ_TOOLS;
export const MCP_WRITE_TOOLS = EXTERNAL_WRITE_TOOLS;

// Writes that land the same state when repeated.
const IDEMPOTENT = new Set(["updateElement", "addElementAssignee", "setElementLabels", "claimElement", "releaseElement"]);
// Writes that overwrite what was there (a title, a description, the whole
// label set) — a client should confirm these the way it confirms a delete.
const OVERWRITES = new Set(["updateElement", "setElementLabels"]);

function toMcp(def: ToolDef): McpTool {
  const readOnly = isReadTool(def.name);
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
  return externalToolDefs(access).map(toMcp);
}

export function mcpHost(supabase: SupabaseClient, actor: BoardActor, access: CallerAccess = "read_write"): ToolHost {
  return {
    tools: mcpTools(access),
    // protocol.ts already refuses tools that are not listed; runExternalTool
    // keeps a read-only host read-only even if called directly.
    call: (name, args) => runExternalTool(supabase, name, args, actor, access),
  };
}
