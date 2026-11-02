import { describe, expect, it } from 'vitest';
import { AI_AGENT_PRESETS, aiProviderOf } from '@/Function/team/aiAgents';

const agent = (name: string, ai_model: string | null = null) => ({ type: 'ai_agent', name, ai_model });

describe('AI agent providers', () => {
  it('reads the provider from the model first, then the name', () => {
    expect(aiProviderOf(agent('Reviewer', 'claude-opus-5-5'))).toBe('claude');
    expect(aiProviderOf(agent('Claude'))).toBe('claude');
    expect(aiProviderOf(agent('Helper', 'gpt-5'))).toBe('openai');
    expect(aiProviderOf(agent('ChatGPT'))).toBe('openai');
    expect(aiProviderOf(agent('Codex', 'o3'))).toBe('openai');
    expect(aiProviderOf(agent('Gemini'))).toBe('gemini');
    expect(aiProviderOf(agent('DeepSeek', 'deepseek-r1'))).toBe('deepseek');
    expect(aiProviderOf(agent('Grok'))).toBe('grok');
    expect(aiProviderOf(agent('Le Chat', 'mistral-large'))).toBe('mistral');
  });

  it('marks no person and no agent of an unknown provider', () => {
    expect(aiProviderOf({ type: 'human', name: 'Claude Monet' })).toBeNull();
    expect(aiProviderOf(agent('Planner'))).toBeNull();
    expect(aiProviderOf(null)).toBeNull();
  });

  it('recognises every preset as its own provider', () => {
    for (const p of AI_AGENT_PRESETS) expect(aiProviderOf(agent(p.name, p.model))).toBe(p.provider);
  });
});
