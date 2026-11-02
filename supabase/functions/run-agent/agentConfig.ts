// How a run is configured. Pure: index.ts loads the Worker and the Domain,
// this file decides whether the run may go on and with what model, turn
// limit and instructions.
//
// The Domain sets the frame for every Element in it: it can switch agents
// off, and its instructions apply to whichever agent works there. Within
// that frame the Worker's own settings win (model, turn limit), and its
// instructions come after the Domain's.

import { DEFAULT_AGENT_MODEL, isAgentModel, type AgentModel } from "../_shared/aiPricing.ts";

export const MIN_AGENT_TURNS = 5;
export const MAX_AGENT_TURNS = 200;
export const DEFAULT_MAX_TOTAL_TURNS = 60;

export interface WorkerConfigRow { name: string | null; ai_config: unknown; ai_model: string | null }
export interface DomainConfigRow { name: string | null; ai_config: unknown }

export interface ResolvedAgentConfig {
  /** Why the run may not go on; null when it may. */
  disabledReason: string | null;
  agentName: string;
  model: AgentModel;
  maxTotalTurns: number;
  /** The Worker's own instructions. */
  instructions: string | null;
  /** The Domain's instructions, for every agent working in it. */
  domainInstructions: string | null;
}

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function turns(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= MIN_AGENT_TURNS && v <= MAX_AGENT_TURNS ? Math.floor(v) : null;
}

export function resolveAgentConfig(worker: WorkerConfigRow | null, domain: DomainConfigRow | null): ResolvedAgentConfig {
  const w = record(worker?.ai_config);
  const d = record(domain?.ai_config);
  const domainLabel = text(domain?.name) ? `「${text(domain?.name)}」` : "";
  return {
    disabledReason: d.enabled === false
      ? `この Domain${domainLabel}ではエージェントの実行が無効になっています。Domain の設定（AI エージェント）で有効にすると実行できます。`
      : null,
    agentName: text(worker?.name) ?? "Alcon Agent",
    model: isAgentModel(w.model) ? w.model
      : worker && isAgentModel(worker.ai_model) ? worker.ai_model
      : isAgentModel(d.model) ? d.model
      : DEFAULT_AGENT_MODEL,
    maxTotalTurns: turns(w.max_turns) ?? turns(d.max_turns) ?? DEFAULT_MAX_TOTAL_TURNS,
    instructions: text(w.instructions),
    domainInstructions: text(d.instructions),
  };
}
