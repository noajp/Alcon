import { describe, expect, it } from 'vitest';
import { buildCopilotContext } from '@/AIP/ai/useAlconCopilot';

const base = { domainId: 'd1', spaceId: 's1', today: '2026-11-07' };

describe('buildCopilotContext', () => {
  it('a subject-less context is exactly what the panel has always sent', () => {
    expect(buildCopilotContext({ subject: null, ...base }))
      .toEqual({ viewLabel: 'Alcon', domainId: 'd1', spaceId: 's1', today: '2026-11-07' });
  });

  it('a slides subject changes nothing — the deck swap is not context', () => {
    expect(buildCopilotContext({ subject: { kind: 'slides' }, ...base }))
      .toEqual(buildCopilotContext({ subject: null, ...base }));
  });

  it('a strategy subject adds its id and speaks under its name', () => {
    expect(buildCopilotContext({ subject: { kind: 'strategy', id: 'st1' }, strategyName: '新規事業', ...base }))
      .toEqual({ viewLabel: '新規事業', domainId: 'd1', spaceId: 's1', today: '2026-11-07', strategyId: 'st1' });
  });

  it('an unresolved strategy name falls back to the plain word', () => {
    const ctx = buildCopilotContext({ subject: { kind: 'strategy', id: 'st1' }, strategyName: null, ...base });
    expect(ctx.viewLabel).toBe('Strategy');
    expect(ctx.strategyId).toBe('st1');
  });

  it('carries no strategyId for any other subject', () => {
    expect(buildCopilotContext({ subject: null, ...base }).strategyId).toBeUndefined();
    expect(buildCopilotContext({ subject: { kind: 'slides' }, ...base }).strategyId).toBeUndefined();
  });

  it('passes an absent domain or space through as absent', () => {
    const ctx = buildCopilotContext({ subject: null, domainId: null, spaceId: null, today: '2026-11-07' });
    expect(ctx.domainId).toBeUndefined();
    expect(ctx.spaceId).toBeUndefined();
    expect(ctx.today).toBe('2026-11-07');
  });
});
