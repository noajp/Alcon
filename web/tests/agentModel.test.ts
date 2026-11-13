import { describe, expect, it } from 'vitest';
import { agentModelDraft, agentModelPatch, needsModelKey, runsInClaudeCode, type AgentModelDraft } from '@/Function/team/agentModel';

const cfg = await import(new URL('../../supabase/functions/run-agent/agentConfig.ts', import.meta.url).pathname);

const anthropic: AgentModelDraft = { runner: 'clayware', providerId: null, model: '', priceInput: '', priceOutput: '' };

describe('agentModelDraft', () => {
  it('reads the connection, model and price a Worker has', () => {
    expect(agentModelDraft({ ai_model: 'deepseek-chat', ai_config: { provider: 'int-1', price_input: 0.3, price_output: 1.2, instructions: 'x' } }))
      .toEqual({ runner: 'clayware', providerId: 'int-1', model: 'deepseek-chat', priceInput: '0.3', priceOutput: '1.2' });
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
    expect(agentModelPatch({ instructions: 'x' }, { runner: 'clayware', providerId: 'int-1', model: 'kimi-k3', priceInput: '', priceOutput: '' }))
      .toEqual({ ok: true, patch: { ai_model: 'kimi-k3', ai_config: { instructions: 'x', provider: 'int-1' } } });
    expect(agentModelPatch(null, { runner: 'clayware', providerId: 'int-1', model: 'kimi-k3', priceInput: '0.6', priceOutput: ' 2.5 ' }))
      .toEqual({ ok: true, patch: { ai_model: 'kimi-k3', ai_config: { provider: 'int-1', price_input: 0.6, price_output: 2.5 } } });
  });

  it('refuses a connection without a model or with a half or bad price', () => {
    expect(agentModelPatch(null, { runner: 'clayware', providerId: 'int-1', model: ' ', priceInput: '', priceOutput: '' })).toEqual({ ok: false, error: 'Enter the model name.' });
    expect(agentModelPatch(null, { runner: 'clayware', providerId: 'int-1', model: 'm', priceInput: '1', priceOutput: '' })).toEqual({ ok: false, error: 'Enter both prices, or neither.' });
    expect(agentModelPatch(null, { runner: 'clayware', providerId: 'int-1', model: 'm', priceInput: '-1', priceOutput: '2' })).toEqual({ ok: false, error: 'Enter prices as numbers of 0 or more.' });
    expect(agentModelPatch(null, { runner: 'clayware', providerId: 'int-1', model: 'm', priceInput: 'abc', priceOutput: '2' }).ok).toBe(false);
  });

  it('writes what the engine reads', () => {
    const built = agentModelPatch(null, { runner: 'clayware', providerId: 'int-1', model: 'deepseek-chat', priceInput: '0.3', priceOutput: '1.2' });
    if (!built.ok) throw new Error(built.error);
    const r = cfg.resolveAgentConfig({ name: 'DeepSeek', ...built.patch }, null);
    expect(r).toMatchObject({ disabledReason: null, providerId: 'int-1', model: 'deepseek-chat', price: { input: 0.3, output: 1.2 } });
  });
});

describe('Claude Code runner', () => {
  it('reads and writes the runner, keeping the rest of ai_config', () => {
    expect(agentModelDraft({ ai_model: null, ai_config: { runner: 'claude-code', instructions: 'x' } }).runner).toBe('claude-code');
    expect(agentModelPatch({ instructions: 'x', provider: 'int-1' }, { runner: 'claude-code', providerId: 'int-1', model: '', priceInput: '', priceOutput: '' }))
      .toEqual({ ok: true, patch: { ai_model: null, ai_config: { instructions: 'x', runner: 'claude-code' } } });
    expect(agentModelPatch({ runner: 'claude-code' }, { runner: 'clayware', providerId: null, model: '', priceInput: '', priceOutput: '' }))
      .toEqual({ ok: true, patch: { ai_model: null, ai_config: {} } });
  });

  it('tells a Claude Code Worker apart', () => {
    expect(runsInClaudeCode({ runner: 'claude-code' })).toBe(true);
    expect(runsInClaudeCode({ provider: 'x' })).toBe(false);
    expect(runsInClaudeCode(null)).toBe(false);
  });
});


describe('needsModelKey', () => {
  const connected = new Set(['conn-1']);
  it('never for people or Claude Code workers', () => {
    expect(needsModelKey({ type: 'human' }, connected, null)).toBe(false);
    expect(needsModelKey({ type: 'ai_agent', ai_config: { runner: 'claude-code' } }, connected, 'gemini')).toBe(false);
  });
  it('Claude on Clayware\'s own key needs none; another provider without a connection does', () => {
    expect(needsModelKey({ type: 'ai_agent', ai_model: 'claude-opus-5-5' }, connected, 'claude')).toBe(false);
    expect(needsModelKey({ type: 'ai_agent', ai_model: 'gemini' }, connected, 'gemini')).toBe(true);
  });
  it('follows the connection a worker names', () => {
    expect(needsModelKey({ type: 'ai_agent', ai_config: { provider: 'conn-1' } }, connected, 'deepseek')).toBe(false);
    expect(needsModelKey({ type: 'ai_agent', ai_config: { provider: 'gone' } }, connected, 'claude')).toBe(true);
  });
});
