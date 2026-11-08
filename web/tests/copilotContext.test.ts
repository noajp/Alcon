import { describe, expect, it } from 'vitest';
import { buildCopilotContext, copilotSubjectFor } from '@/AIP/ai/useAlconCopilot';

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

describe('copilotSubjectFor', () => {
  it('the Slides view speaks to the open deck', () => {
    expect(copilotSubjectFor({ activeView: 'slides', strategyId: null, lastStrategyId: 'st1' }))
      .toEqual({ kind: 'slides' });
  });

  it('the Strategy view speaks to the Strategy open there', () => {
    expect(copilotSubjectFor({ activeView: 'strategy', strategyId: 'st2', lastStrategyId: 'st1' }))
      .toEqual({ kind: 'strategy', id: 'st2' });
  });

  it('the Strategy view with none open has no subject, retained or not', () => {
    expect(copilotSubjectFor({ activeView: 'strategy', strategyId: null, lastStrategyId: 'st1' }))
      .toBeNull();
    expect(copilotSubjectFor({ activeView: 'strategy', strategyId: null, lastStrategyId: null }))
      .toBeNull();
  });

  it('the AI screen keeps the last Strategy the person had open', () => {
    expect(copilotSubjectFor({ activeView: 'ai', strategyId: null, lastStrategyId: 'st1' }))
      .toEqual({ kind: 'strategy', id: 'st1' });
  });

  it('the AI screen with no Strategy ever open has no subject', () => {
    expect(copilotSubjectFor({ activeView: 'ai', strategyId: null, lastStrategyId: null }))
      .toBeNull();
  });

  it('any other view has no subject, retained or not', () => {
    expect(copilotSubjectFor({ activeView: 'inbox', strategyId: null, lastStrategyId: 'st1' }))
      .toBeNull();
    expect(copilotSubjectFor({ activeView: 'objects', strategyId: null, lastStrategyId: null }))
      .toBeNull();
  });

  it('a send from the AI screen carries the retained Strategy as context', () => {
    const subject = copilotSubjectFor({ activeView: 'ai', strategyId: null, lastStrategyId: 'st1' });
    expect(buildCopilotContext({ subject, strategyName: '新規事業', ...base }))
      .toEqual({ viewLabel: '新規事業', domainId: 'd1', spaceId: 's1', today: '2026-11-07', strategyId: 'st1' });
  });
});
