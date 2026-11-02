// Which model an AI agent Worker runs on: Anthropic (Alcon's own key), or a
// model connection of its Space (Settings › Integrations, kind 'model') with
// the model named in ai_model. run-agent reads the same fields
// (supabase/functions/run-agent/agentConfig.ts): ai_config.provider is the
// connection's id, ai_config.price_input / price_output its price in USD per
// million tokens. A connection without a price is charged at Claude Sonnet's
// price, so the Space's budget errs on stopping early.
//
// Pure — the dialog in Settings › Team calls it, tests/agentModel.test.ts
// checks it. Error strings are English source strings for t().

import type { Json } from '@/types/database';

export interface AgentModelDraft {
  /** The model connection's id; null for Anthropic. */
  providerId: string | null;
  model: string;
  /** As typed: blank, or a number of USD per million tokens. */
  priceInput: string;
  priceOutput: string;
}

function record(v: unknown): Record<string, Json | undefined> {
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, Json | undefined>) } : {};
}

function priceText(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? String(v) : '';
}

/** Pure. The dialog's starting values for a Worker. */
export function agentModelDraft(worker: { ai_model: string | null; ai_config: Json | null }): AgentModelDraft {
  const c = record(worker.ai_config);
  return {
    providerId: typeof c.provider === 'string' && c.provider ? c.provider : null,
    model: worker.ai_model ?? '',
    priceInput: priceText(c.price_input),
    priceOutput: priceText(c.price_output),
  };
}

export type AgentModelPatch = { ok: true; patch: { ai_model: string | null; ai_config: Json } } | { ok: false; error: string };

function readPrice(raw: string): number | null | undefined {
  const s = raw.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Pure. The Worker update for a draft, or why it can't be saved. Settings
 *  in ai_config other than the model's (instructions, turn limit) are kept. */
export function agentModelPatch(aiConfig: Json | null, draft: AgentModelDraft): AgentModelPatch {
  const config = record(aiConfig);
  delete config.provider;
  delete config.price_input;
  delete config.price_output;
  const model = draft.model.trim();
  if (!draft.providerId) return { ok: true, patch: { ai_model: model || null, ai_config: config } };

  if (!model) return { ok: false, error: 'Enter the model name.' };
  const input = readPrice(draft.priceInput);
  const output = readPrice(draft.priceOutput);
  if (input === undefined || output === undefined) return { ok: false, error: 'Enter prices as numbers of 0 or more.' };
  if ((input === null) !== (output === null)) return { ok: false, error: 'Enter both prices, or neither.' };
  config.provider = draft.providerId;
  if (input !== null && output !== null) {
    config.price_input = input;
    config.price_output = output;
  }
  return { ok: true, patch: { ai_model: model, ai_config: config } };
}
