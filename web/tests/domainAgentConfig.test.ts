import { describe, expect, it } from 'vitest';
import {
  DOMAIN_AGENT_MODELS, DEFAULT_DOMAIN_AGENT_MODEL, DOMAIN_AGENT_TURNS, clampAgentTurns, domainAgentModel,
} from '@/Function/domain/domainAgentConfig';

const cfg = await import(new URL('../../supabase/functions/run-agent/agentConfig.ts', import.meta.url).pathname);
const ctx = await import(new URL('../../supabase/functions/run-agent/context.ts', import.meta.url).pathname);
const pricing = await import(new URL('../../supabase/functions/_shared/aiPricing.ts', import.meta.url).pathname);

const { resolveAgentConfig } = cfg;

describe('Domain agent settings screen', () => {
  it('offers exactly the models the engine runs', () => {
    expect(DOMAIN_AGENT_MODELS.map((m) => m.value).sort()).toEqual(Object.keys(pricing.AGENT_MODELS).sort());
    expect(DEFAULT_DOMAIN_AGENT_MODEL).toBe(pricing.DEFAULT_AGENT_MODEL);
  });

  it('uses the engine turn limits', () => {
    expect(DOMAIN_AGENT_TURNS).toEqual({ min: cfg.MIN_AGENT_TURNS, max: cfg.MAX_AGENT_TURNS, default: cfg.DEFAULT_MAX_TOTAL_TURNS });
  });

  it('falls back to the default for a model the engine does not know', () => {
    expect(domainAgentModel('claude-haiku-5-5')).toBe('claude-haiku-5-5');
    expect(domainAgentModel('claude-sonnet-4-6')).toBe(DEFAULT_DOMAIN_AGENT_MODEL);
    expect(domainAgentModel(undefined)).toBe(DEFAULT_DOMAIN_AGENT_MODEL);
  });

  it('clamps the turn limit', () => {
    expect(clampAgentTurns('1')).toBe(5);
    expect(clampAgentTurns('999')).toBe(200);
    expect(clampAgentTurns('42.7')).toBe(42);
    expect(clampAgentTurns('')).toBe(60);
  });
});

describe('resolveAgentConfig', () => {
  const worker = (ai_config: unknown, ai_model: string | null = null) => ({ name: 'Writer', ai_config, ai_model });
  const domain = (ai_config: unknown) => ({ name: 'Sales', ai_config });

  it('runs as the default agent with no Worker and no Domain settings', () => {
    expect(resolveAgentConfig(null, null)).toEqual({
      disabledReason: null, agentName: 'Alcon Agent', model: pricing.DEFAULT_AGENT_MODEL,
      providerId: null, price: pricing.AGENT_MODELS[pricing.DEFAULT_AGENT_MODEL],
      modelLabel: pricing.AGENT_MODELS[pricing.DEFAULT_AGENT_MODEL].label,
      maxTotalTurns: cfg.DEFAULT_MAX_TOTAL_TURNS, instructions: null, domainInstructions: null,
    });
  });

  it('refuses when the Domain switched agents off, naming the Domain', () => {
    const r = resolveAgentConfig(worker({}), domain({ enabled: false }));
    expect(r.disabledReason).toContain('「Sales」');
    expect(r.disabledReason).toContain('無効');
    expect(resolveAgentConfig(null, domain({ enabled: true })).disabledReason).toBeNull();
    expect(resolveAgentConfig(null, domain({})).disabledReason).toBeNull();
  });

  it('picks the model Worker config > Worker model > Domain > default', () => {
    expect(resolveAgentConfig(worker({ model: 'claude-opus-5-5' }, 'claude-haiku-5-5'), domain({ model: 'claude-haiku-5-5' })).model).toBe('claude-opus-5-5');
    expect(resolveAgentConfig(worker({}, 'claude-opus-5-5'), domain({ model: 'claude-haiku-5-5' })).model).toBe('claude-opus-5-5');
    expect(resolveAgentConfig(worker({}), domain({ model: 'claude-haiku-5-5' })).model).toBe('claude-haiku-5-5');
    expect(resolveAgentConfig(null, domain({ model: 'claude-sonnet-4-6' })).model).toBe(pricing.DEFAULT_AGENT_MODEL);
  });

  it('runs on the Worker\'s model connection with the model it names', () => {
    const r = resolveAgentConfig(worker({ provider: 'int-1', price_input: 0.3, price_output: 1.2 }, 'deepseek-chat'), domain({ model: 'claude-haiku-5-5' }));
    expect(r.disabledReason).toBeNull();
    expect(r.providerId).toBe('int-1');
    expect(r.model).toBe('deepseek-chat');
    expect(r.modelLabel).toBe('deepseek-chat');
    expect(r.price).toEqual({ input: 0.3, output: 1.2, cacheRead: 0.3 });
  });

  it('charges a connection without a price at Claude Sonnet\'s price', () => {
    expect(resolveAgentConfig(worker({ provider: 'int-1' }, 'kimi-k3'), null).price).toEqual(pricing.UNPRICED_MODEL);
    expect(resolveAgentConfig(worker({ provider: 'int-1', price_input: 1 }, 'kimi-k3'), null).price).toEqual(pricing.UNPRICED_MODEL);
    expect(resolveAgentConfig(worker({ provider: 'int-1', price_input: -1, price_output: 2 }, 'kimi-k3'), null).price).toEqual(pricing.UNPRICED_MODEL);
  });

  it('does not run on a connection without a model name', () => {
    expect(resolveAgentConfig(worker({ provider: 'int-1' }), null).disabledReason).toContain('モデル名');
  });

  it('does not quietly run another provider\'s model on Claude', () => {
    const r = resolveAgentConfig({ name: 'DeepSeek', ai_config: null, ai_model: 'deepseek' }, null);
    expect(r.disabledReason).toContain('「deepseek」');
    expect(r.disabledReason).toContain('接続先');
    // A Claude model the engine does not list still runs on the default Claude model.
    expect(resolveAgentConfig(worker({}, 'claude-opus-4-7'), null)).toMatchObject({ disabledReason: null, model: pricing.DEFAULT_AGENT_MODEL, providerId: null });
    // The Domain being switched off is the reason given first.
    expect(resolveAgentConfig({ name: 'DeepSeek', ai_config: null, ai_model: 'deepseek' }, domain({ enabled: false })).disabledReason).toContain('無効');
  });

  it('takes the turn limit from the Worker, else the Domain, within the engine range', () => {
    expect(resolveAgentConfig(worker({ max_turns: 30 }), domain({ max_turns: 100 })).maxTotalTurns).toBe(30);
    expect(resolveAgentConfig(worker({}), domain({ max_turns: 100 })).maxTotalTurns).toBe(100);
    expect(resolveAgentConfig(null, domain({ max_turns: 3 })).maxTotalTurns).toBe(cfg.DEFAULT_MAX_TOTAL_TURNS);
    expect(resolveAgentConfig(null, domain({ max_steps: 6 })).maxTotalTurns).toBe(cfg.DEFAULT_MAX_TOTAL_TURNS);
  });

  it('keeps the Domain and Worker instructions apart', () => {
    const r = resolveAgentConfig(worker({ instructions: '  箇条書きで  ' }), domain({ instructions: 'SEM は略語' }));
    expect(r.instructions).toBe('箇条書きで');
    expect(r.domainInstructions).toBe('SEM は略語');
    expect(resolveAgentConfig(null, domain({ instructions: '   ' })).domainInstructions).toBeNull();
  });
});

describe('systemPrompt with Domain instructions', () => {
  it('puts the Domain instructions in, before the Worker instructions', () => {
    const p: string = ctx.systemPrompt({ name: 'Writer', instructions: 'WORKER_RULE', domainInstructions: 'DOMAIN_RULE' });
    expect(p).toContain('# この Domain の指示（設定）\nDOMAIN_RULE');
    expect(p).toContain('# このエージェントへの指示（設定）\nWORKER_RULE');
    expect(p.indexOf('DOMAIN_RULE')).toBeLessThan(p.indexOf('WORKER_RULE'));
  });

  it('leaves the heading out when the Domain gives none', () => {
    expect(ctx.systemPrompt({ name: 'Writer', instructions: null })).not.toContain('Domain の指示');
  });
});
