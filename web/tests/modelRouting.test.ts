import { describe, expect, it } from 'vitest';
import { normalizePlan } from '@/ActivitySpace/strategy/initiative/mission/missionModel';

const cfg = await import(new URL('../../supabase/functions/run-agent/agentConfig.ts', import.meta.url).pathname);
const tl = await import(new URL('../../supabase/functions/run-agent/toolLoading.ts', import.meta.url).pathname);

const plain = { name: 'Claude', ai_config: null, ai_model: null };

describe('model by weight', () => {
  it('picks the model by the Element\'s weight when nothing names one', () => {
    expect(cfg.resolveAgentConfig(plain, null, 'light')).toMatchObject({ model: 'claude-haiku-5-5', routedBy: 'light' });
    expect(cfg.resolveAgentConfig(plain, null, 'heavy')).toMatchObject({ model: 'claude-opus-5-5', routedBy: 'heavy' });
    expect(cfg.resolveAgentConfig(plain, null, 'standard')).toMatchObject({ model: 'claude-sonnet-5-5', routedBy: 'standard' });
    expect(cfg.resolveAgentConfig(plain, null, null)).toMatchObject({ model: 'claude-sonnet-5-5', routedBy: null });
    expect(cfg.resolveAgentConfig(plain, null, 'huge')).toMatchObject({ model: 'claude-sonnet-5-5', routedBy: null });
  });

  it('lets a model named on the Worker or the Domain win over the weight', () => {
    expect(cfg.resolveAgentConfig({ ...plain, ai_model: 'claude-sonnet-5-5' }, null, 'light')).toMatchObject({ model: 'claude-sonnet-5-5', routedBy: null });
    expect(cfg.resolveAgentConfig(plain, { name: 'D', ai_config: { model: 'claude-opus-5-5' } }, 'light')).toMatchObject({ model: 'claude-opus-5-5', routedBy: null });
  });

  it('keeps a run under way on the model it started on', () => {
    expect(cfg.resolveAgentConfig(plain, null, 'light', 'claude-sonnet-5-5')).toMatchObject({ model: 'claude-sonnet-5-5', routedBy: null });
    expect(cfg.resolveAgentConfig(plain, null, 'light', 'claude-haiku-5-5')).toMatchObject({ model: 'claude-haiku-5-5', routedBy: 'light' });
    expect(cfg.resolveAgentConfig(plain, null, 'light', 'gpt-x')).toMatchObject({ model: 'claude-haiku-5-5' });
  });

  it('reads the weight the Planner gives a task, and nothing else', () => {
    const plan = normalizePlan({ tasks: [
      { key: 't1', title: 'A', weight: 'light' }, { key: 't2', title: 'B', weight: 'giant' }, { key: 't3', title: 'C' },
    ] }, new Set());
    expect(plan.tasks.map((t) => t.weight)).toEqual(['light', null, null]);
  });
});

const tool = (name: string) => ({ name, description: name, input_schema: { type: 'object', properties: {} } });

describe('tool loading', () => {
  it('defers a connection\'s tools only once there are many', () => {
    const always = [tool('board_a'), tool('board_b')];
    const few = tl.withDeferral(always, [tool('gh_1'), tool('gh_2')]);
    expect(few.some((t: { defer?: boolean }) => t.defer)).toBe(false);
    expect(tl.needsToolSearch(few)).toBe(false);
    const many = tl.withDeferral(always, Array.from({ length: 11 }, (_, i) => tool(`gh_${i}`)));
    expect(many.filter((t: { defer?: boolean }) => t.defer)).toHaveLength(11);
    expect(many.slice(0, 2).every((t: { defer?: boolean }) => !t.defer)).toBe(true);
    expect(tl.needsToolSearch(many)).toBe(true);
    // Nothing always loaded: never defer everything (the API refuses it).
    expect(tl.needsToolSearch(tl.withDeferral([], Array.from({ length: 20 }, (_, i) => tool(`x${i}`))))).toBe(false);
  });

  it('marks the cache on the last loaded tool and sends deferred ones after it', () => {
    const tools = [tool('a'), { ...tool('d1'), defer: true }, tool('b'), { ...tool('d2'), defer: true }];
    const cache = { cache_control: { type: 'ephemeral' } };
    const params = tl.toolParamsFor(tools, cache, false);
    expect(params.map((p: { name: string }) => p.name)).toEqual(['a', 'b', 'd1', 'd2']);
    expect(params[1]).toMatchObject({ name: 'b', ...cache });
    expect(params[2]).toMatchObject({ name: 'd1', defer_loading: true });
    expect(params[2]).not.toHaveProperty('cache_control');
    expect(params[0]).not.toHaveProperty('cache_control');
    expect(params.some((p: Record<string, unknown>) => 'defer' in p)).toBe(false);
  });

  it('sends another provider every tool loaded', () => {
    const params = tl.toolParamsFor([tool('a'), { ...tool('d1'), defer: true }], {}, true);
    expect(params.some((p: Record<string, unknown>) => 'defer_loading' in p)).toBe(false);
  });
});
