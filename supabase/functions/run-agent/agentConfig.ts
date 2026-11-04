// How a run is configured. Pure: index.ts loads the Worker and the Domain,
// this file decides whether the run may go on and with what model, turn
// limit and instructions.
//
// The Domain sets the frame for every Element in it: it can switch agents
// off, and its instructions apply to whichever agent works there. Within
// that frame the Worker's own settings win (model, turn limit), and its
// instructions come after the Domain's.
//
// A Worker may run on another provider: ai_config.provider names a model
// integration of its Space and ai_model the model there. Without one the run
// is Anthropic's, on a Claude model; a Worker whose model names another
// provider's model and has no provider set does not run, rather than quietly
// running on Claude under that name.
//
// With no model named on the Worker or the Domain, the Element's weight picks
// one by cost: light work on the small model, heavy on the large one. A run
// already under way keeps the Claude model it started on: its thinking is
// bound to that model, and a changed setting applies from the next run.

import { AGENT_MODELS, DEFAULT_AGENT_MODEL, UNPRICED_MODEL, isAgentModel, type AgentModel, type ModelPrice } from "../_shared/aiPricing.ts";

export type AiWeight = "light" | "standard" | "heavy";

/** The model each weight runs on when nothing names one. */
export const WEIGHT_MODELS: Record<AiWeight, AgentModel> = {
  light: "claude-haiku-5-5",
  standard: DEFAULT_AGENT_MODEL,
  heavy: "claude-opus-5-5",
};

export function isAiWeight(v: unknown): v is AiWeight {
  return v === "light" || v === "standard" || v === "heavy";
}

export const MIN_AGENT_TURNS = 5;
export const MAX_AGENT_TURNS = 200;
export const DEFAULT_MAX_TOTAL_TURNS = 60;

export interface WorkerConfigRow { name: string | null; ai_config: unknown; ai_model: string | null }
export interface DomainConfigRow { name: string | null; ai_config: unknown }

export interface ResolvedAgentConfig {
  /** Why the run may not go on; null when it may. */
  disabledReason: string | null;
  agentName: string;
  /** A Claude model (AGENT_MODELS) when providerId is null; else the
   *  provider's own model name. */
  model: string;
  /** The model integration the run calls; null for Anthropic. */
  providerId: string | null;
  /** What the model is charged at, for the budget. */
  price: ModelPrice;
  /** How the model is named in the run's log. */
  modelLabel: string;
  maxTotalTurns: number;
  /** The Worker's own instructions. */
  instructions: string | null;
  /** The Domain's instructions, for every agent working in it. */
  domainInstructions: string | null;
  /** The weight that picked the model; null when a setting named it. */
  routedBy: AiWeight | null;
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

function price(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Pure. True when a model name says it is Claude's (an older or newer one
 *  the engine does not list still runs on the default Claude model). */
function claudeNamed(model: string): boolean {
  return /claude|anthropic/i.test(model);
}

export function resolveAgentConfig(worker: WorkerConfigRow | null, domain: DomainConfigRow | null, weight: unknown = null, startedOn: string | null = null): ResolvedAgentConfig {
  const w = record(worker?.ai_config);
  const d = record(domain?.ai_config);
  const domainLabel = text(domain?.name) ? `「${text(domain?.name)}」` : "";
  const agentName = text(worker?.name) ?? "Alcon Agent";
  const providerId = text(w.provider);
  const workerModel = text(worker?.ai_model);
  let disabledReason = d.enabled === false
    ? `この Domain${domainLabel}ではエージェントの実行が無効になっています。Domain の設定（AI エージェント）で有効にすると実行できます。`
    : null;

  let model: string;
  let modelPrice: ModelPrice;
  let modelLabel: string;
  let routedBy: AiWeight | null = null;
  if (providerId) {
    model = workerModel ?? "";
    if (!model && !disabledReason) disabledReason = `${agentName} の接続先で使うモデル名が設定されていません。チーム設定でこのエージェントのモデルを入力すると実行できます。`;
    const input = price(w.price_input);
    const output = price(w.price_output);
    modelPrice = input != null && output != null ? { input, output, cacheRead: input } : UNPRICED_MODEL;
    modelLabel = model;
  } else {
    if (workerModel && !isAgentModel(w.model) && !isAgentModel(workerModel) && !claudeNamed(workerModel) && !disabledReason) {
      disabledReason = `${agentName} のモデル「${workerModel}」には接続先が設定されていません。設定 › カスタマイズで AI モデルの接続を追加し、チーム設定でこのエージェントの接続先に選ぶと実行できます。`;
    }
    const named = isAgentModel(w.model) ? w.model
      : isAgentModel(workerModel) ? workerModel
      : isAgentModel(d.model) ? d.model
      : null;
    if (!named && isAiWeight(weight)) routedBy = weight;
    const routed = named ?? (routedBy ? WEIGHT_MODELS[routedBy] : DEFAULT_AGENT_MODEL);
    const claude = isAgentModel(startedOn) ? startedOn : routed;
    if (claude !== routed) routedBy = null;
    model = claude;
    modelPrice = AGENT_MODELS[claude];
    modelLabel = AGENT_MODELS[claude].label;
  }

  return {
    disabledReason,
    agentName,
    model,
    providerId,
    price: modelPrice,
    modelLabel,
    maxTotalTurns: turns(w.max_turns) ?? turns(d.max_turns) ?? DEFAULT_MAX_TOTAL_TURNS,
    instructions: text(w.instructions),
    domainInstructions: text(d.instructions),
    routedBy,
  };
}
