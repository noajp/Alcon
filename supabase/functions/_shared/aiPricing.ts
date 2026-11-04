// What a model call costs, for the per-Space monthly agent budget.
// Anthropic first-party list prices, USD per million tokens (2026-09).
// Cache writes cost 1.25x input; cache reads are priced per model.

export const AGENT_MODELS = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, label: "Claude Sonnet 5.5" },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, label: "Claude Haiku 5.5" },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, label: "Claude Opus 5.5" },
} as const;

export type AgentModel = keyof typeof AGENT_MODELS;

export const DEFAULT_AGENT_MODEL: AgentModel = "claude-sonnet-5-5";

export function isAgentModel(v: unknown): v is AgentModel {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(AGENT_MODELS, v);
}

export interface ModelUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  /** Server tools the response used; web searches are billed per request. */
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** USD per web search request ($10 per 1,000). */
export const WEB_SEARCH_USD = 0.01;

/** USD per million tokens. */
export interface ModelPrice { input: number; output: number; cacheRead: number }

/** What a model on another provider is charged at when its Worker states no
 *  price: Claude Sonnet's, so a budget errs on stopping early. */
export const UNPRICED_MODEL: ModelPrice = { input: AGENT_MODELS["claude-sonnet-5-5"].input, output: AGENT_MODELS["claude-sonnet-5-5"].output, cacheRead: AGENT_MODELS["claude-sonnet-5-5"].cacheRead };

/** Pure. USD for one response's usage on a model. */
export function costOf(model: AgentModel, usage: ModelUsage): number {
  return costAt(AGENT_MODELS[model], usage);
}

/** Pure. USD for one response's usage at a price. */
export function costAt(p: ModelPrice, usage: ModelUsage): number {
  const n = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? v : 0);
  const usd =
    (n(usage.input_tokens) * p.input +
      n(usage.cache_creation_input_tokens) * p.input * 1.25 +
      n(usage.cache_read_input_tokens) * p.cacheRead +
      n(usage.output_tokens) * p.output) / 1_000_000 +
    n(usage.server_tool_use?.web_search_requests) * WEB_SEARCH_USD;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
