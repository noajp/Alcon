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
    expect(domainAgentModel('claude-haiku-4-5')).toBe('claude-haiku-4-5');
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
    expect(resolveAgentConfig(worker({ model: 'claude-opus-5-5' }, 'claude-haiku-4-5'), domain({ model: 'claude-haiku-4-5' })).model).toBe('claude-opus-5-5');
    expect(resolveAgentConfig(worker({}, 'claude-opus-5-5'), domain({ model: 'claude-haiku-4-5' })).model).toBe('claude-opus-5-5');
    expect(resolveAgentConfig(worker({}), domain({ model: 'claude-haiku-4-5' })).model).toBe('claude-haiku-4-5');
    expect(resolveAgentConfig(null, domain({ model: 'claude-sonnet-4-6' })).model).toBe(pricing.DEFAULT_AGENT_MODEL);
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
