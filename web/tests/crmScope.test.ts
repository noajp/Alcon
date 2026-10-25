import { describe, expect, it } from 'vitest';
import { scopeWorkspace, type CrmWorkspace } from '@/Function/crm/crmModel';
import { inToolScope, resolveToolScope, SPACE_SCOPE } from '@/Function/shared/tool/toolScope';

const workspace = (id: string, totals: CrmWorkspace['totals'], deals: string[] = []): CrmWorkspace => ({
  today: '2026-10-06',
  pipeline: { id, name: id } as CrmWorkspace['pipeline'],
  params: { horizonDays: 30, followUpDays: 14, renewalDays: 90 },
  stages: [],
  deals: deals.map(name => ({ id: name, name }) as unknown as CrmWorkspace['deals'][number]),
  primaryCurrency: totals[0]?.currency ?? null,
  totals,
});
const total = (currency: string, pipeline: number) => ({ currency, pipeline, weightedPipeline: pipeline / 2, forecast: pipeline / 4, won: 1, openCount: 2 });

describe('scopeWorkspace', () => {
  it('returns the one pipeline unchanged', () => {
    const only = workspace('a', [total('JPY', 100)]);
    expect(scopeWorkspace([only], only)).toBe(only);
  });

  it('pools deals and adds totals per currency, never across', () => {
    const a = workspace('a', [total('JPY', 100), total('USD', 10)], ['d1']);
    const b = workspace('b', [total('JPY', 50)], ['d2', 'd3']);
    const pooled = scopeWorkspace([a, b], a);
    expect(pooled.deals.map(deal => deal.id)).toEqual(['d1', 'd2', 'd3']);
    expect(pooled.totals).toEqual([
      { currency: 'JPY', pipeline: 150, weightedPipeline: 75, forecast: 37.5, won: 2, openCount: 4 },
      { currency: 'USD', pipeline: 10, weightedPipeline: 5, forecast: 2.5, won: 1, openCount: 2 },
    ]);
  });

  it('heads with the currency that has the largest open pipeline', () => {
    const a = workspace('a', [total('USD', 10)]);
    const b = workspace('b', [total('JPY', 500)]);
    expect(scopeWorkspace([a, b], a).primaryCurrency).toBe('JPY');
  });
});

describe('tool scope', () => {
  it('keeps everything, the Space and a visible Domain', () => {
    expect(resolveToolScope(null, ['d1'])).toBeNull();
    expect(resolveToolScope(SPACE_SCOPE, ['d1'])).toBe(SPACE_SCOPE);
    expect(resolveToolScope('d1', ['d1'])).toBe('d1');
  });

  it('falls back to everything for a Domain that cannot be chosen', () => {
    expect(resolveToolScope('gone', ['d1'])).toBeNull();
    expect(resolveToolScope('', ['d1'])).toBeNull();
  });

  it('places records by their Domain', () => {
    expect(inToolScope(null, 'd1')).toBe(true);
    expect(inToolScope(SPACE_SCOPE, null)).toBe(true);
    expect(inToolScope(SPACE_SCOPE, 'd1')).toBe(false);
    expect(inToolScope('d1', 'd1')).toBe(true);
    expect(inToolScope('d1', null)).toBe(false);
  });
});
