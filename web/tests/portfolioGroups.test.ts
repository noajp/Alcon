import { describe, expect, it } from 'vitest';
import { groupByPortfolio, initiativesInSpace } from '../src/ActivitySpace/strategy/portfolio/portfolioGroups';
import type { Portfolio } from '../src/types/database';

const p = (id: string, order = 0): Portfolio => ({
  id, activity_space_id: 'sp', name: id, description: null, order_index: order,
  created_by: 'u', created_at: '2026-09-18T00:00:00Z', updated_at: '2026-09-18T00:00:00Z',
});
const s = (id: string, portfolio_id: string | null, parentIds: string[] = [], objectIds: string[] = []) => ({ id, name: id, portfolio_id, parentIds, objectIds });

describe('groupByPortfolio', () => {
  it('puts each root Initiative under its Portfolio and the rest last', () => {
    const { groups, unassigned } = groupByPortfolio([p('A'), p('B')], [s('i1', 'A'), s('i2', 'B'), s('i3', null), s('i4', 'A')]);
    expect(groups.map((g) => [g.portfolio.id, g.initiatives.map((i) => i.id)])).toEqual([['A', ['i1', 'i4']], ['B', ['i2']]]);
    expect(unassigned.map((i) => i.id)).toEqual(['i3']);
  });

  it('treats a Portfolio id that no longer exists as unassigned', () => {
    const { groups, unassigned } = groupByPortfolio([p('A')], [s('i1', 'gone')]);
    expect(groups[0].initiatives).toEqual([]);
    expect(unassigned.map((i) => i.id)).toEqual(['i1']);
  });

  it('leaves nested Initiatives to their parent', () => {
    const { groups, unassigned } = groupByPortfolio([p('A')], [s('root', 'A'), s('child', 'A', ['root']), s('orphanChild', null, ['x'])]);
    expect(groups[0].initiatives.map((i) => i.id)).toEqual(['root']);
    expect(unassigned).toEqual([]);
  });

  it('keeps the Portfolio order given', () => {
    const { groups } = groupByPortfolio([p('B', 1), p('A', 0)], []);
    expect(groups.map((g) => g.portfolio.id)).toEqual(['B', 'A']);
  });
});

describe('initiativesInSpace', () => {
  const objectDomain = new Map<string, string | null>([['o1', 'd1'], ['o2', 'd2'], ['o3', null]]);
  it('keeps Initiatives with an Object in one of the Space\'s Domains, and Object-less ones', () => {
    const kept = initiativesInSpace(
      [s('here', null, [], ['o1']), s('elsewhere', null, [], ['o2']), s('fresh', null, [], []), s('mixed', null, [], ['o2', 'o1']), s('undomained', null, [], ['o3'])],
      objectDomain, new Set(['d1']));
    expect(kept.map((i) => i.id)).toEqual(['here', 'fresh', 'mixed']);
  });
});
