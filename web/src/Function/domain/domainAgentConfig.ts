// The choices the Domain's agent settings offer. They mirror the agent
// engine (supabase/functions/_shared/aiPricing.ts AGENT_MODELS and
// run-agent/agentConfig.ts turn limits) — a value the engine does not know
// would be ignored at run time. tests/domainAgentConfig.test.ts keeps the two
// in step.

export const DOMAIN_AGENT_MODELS = [
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — 標準' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — 高速・低コスト' },
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 — 高品質' },
] as const;

export const DEFAULT_DOMAIN_AGENT_MODEL = 'claude-sonnet-5-5';

/** Turns a run may take in all (one turn = one model call). */
export const DOMAIN_AGENT_TURNS = { min: 5, max: 200, default: 60 } as const;

/** Pure. A stored model the engine knows, else the default. */
export function domainAgentModel(v: unknown): string {
  return DOMAIN_AGENT_MODELS.some((m) => m.value === v) ? (v as string) : DEFAULT_DOMAIN_AGENT_MODEL;
}

/** Pure. A typed turn limit, clamped to what the engine accepts. */
export function clampAgentTurns(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return DOMAIN_AGENT_TURNS.default;
  return Math.min(DOMAIN_AGENT_TURNS.max, Math.max(DOMAIN_AGENT_TURNS.min, Math.floor(n)));
}
