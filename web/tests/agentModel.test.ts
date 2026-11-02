import { describe, expect, it } from 'vitest';
import { agentModelDraft, agentModelPatch, type AgentModelDraft } from '@/Function/team/agentModel';

const cfg = await import(new URL('../../supabase/functions/run-agent/agentConfig.ts', import.meta.url).pathname);

const anthropic: AgentModelDraft = { providerId: null, model: '', priceInput: '', priceOutput: '' };

describe('agentModelDraft', () => {
  it('reads the connection, model and price a Worker has', () => {
    expect(agentModelDraft({ ai_model: 'deepseek-chat', ai_config: { provider: 'int-1', price_input: 0.3, price_output: 1.2, instructions: 'x' } }))
      .toEqual({ providerId: 'int-1', model: 'deepseek-chat', priceInput: '0.3', priceOutput: '1.2' });
    expect(agentModelDraft({ ai_model: null, ai_config: null })).toEqual(anthropic);
    expect(agentModelDraft({ ai_model: 'x', ai_config: { provider: '', price_input: 'cheap' } })).toEqual({ ...anthropic, model: 'x' });
  });
});

describe('agentModelPatch', () => {
  it('keeps the rest of ai_config and drops the connection for Anthropic', () => {
    expect(agentModelPatch({ provider: 'int-1', price_input: 1, price_output: 2, instructions: 'Be brief', max_turns: 30 }, { ...anthropic, model: ' claude-opus-5-5 ' }))
      .toEqual({ ok: true, patch: { ai_model: 'claude-opus-5-5', ai_config: { instructions: 'Be brief', max_turns: 30 } } });
    expect(agentModelPatch(null, anthropic)).toEqual({ ok: true, patch: { ai_model: null, ai_config: {} } });
  });

  it('sets the connection with a model name, and a price only when both are given', () => {
    expect(agentModelPatch({ instructions: 'x' }, { providerId: 'int-1', model: 'kimi-k3', priceInput: '', priceOutput: '' }))
      .toEqual({ ok: true, patch: { ai_model: 'kimi-k3', ai_config: { instructions: 'x', provider: 'int-1' } } });
    expect(agentModelPatch(null, { providerId: 'int-1', model: 'kimi-k3', priceInput: '0.6', priceOutput: ' 2.5 ' }))
      .toEqual({ ok: true, patch: { ai_model: 'kimi-k3', ai_config: { provider: 'int-1', price_input: 0.6, price_output: 2.5 } } });
  });

  it('refuses a connection without a model or with a half or bad price', () => {
    expect(agentModelPatch(null, { providerId: 'int-1', model: ' ', priceInput: '', priceOutput: '' })).toEqual({ ok: false, error: 'Enter the model name.' });
    expect(agentModelPatch(null, { providerId: 'int-1', model: 'm', priceInput: '1', priceOutput: '' })).toEqual({ ok: false, error: 'Enter both prices, or neither.' });
    expect(agentModelPatch(null, { providerId: 'int-1', model: 'm', priceInput: '-1', priceOutput: '2' })).toEqual({ ok: false, error: 'Enter prices as numbers of 0 or more.' });
    expect(agentModelPatch(null, { providerId: 'int-1', model: 'm', priceInput: 'abc', priceOutput: '2' }).ok).toBe(false);
  });

  it('writes what the engine reads', () => {
    const built = agentModelPatch(null, { providerId: 'int-1', model: 'deepseek-chat', priceInput: '0.3', priceOutput: '1.2' });
    if (!built.ok) throw new Error(built.error);
    const r = cfg.resolveAgentConfig({ name: 'DeepSeek', ...built.patch }, null);
    expect(r).toMatchObject({ disabledReason: null, providerId: 'int-1', model: 'deepseek-chat', price: { input: 0.3, output: 1.2 } });
  });
});
