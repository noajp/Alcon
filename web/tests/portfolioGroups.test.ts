import { describe, expect, it } from 'vitest';
import {
  buildPortfolioTree, flattenTree, groupByPortfolio, initiativesInSpace, initiativesOfVision, portfolioPath, rollupPortfolio, subtreeIds,
} from '../src/ActivitySpace/strategy/portfolio/portfolioGroups';
import type { Portfolio } from '../src/types/database';

const p = (id: string, parent_id: string | null = null, order = 0): Portfolio => ({
  id, activity_space_id: 'sp', vision_id: 'v', parent_id, name: id, description: null, order_index: order,
  created_by: 'u', created_at: `2026-09-18T00:00:0${order}Z`, updated_at: '2026-09-18T00:00:00Z',
});
const s = (id: string, portfolio_id: string | null, parentIds: string[] = [], objectIds: string[] = [], vision_id: string | null = null) => ({ id, name: id, portfolio_id, vision_id, parentIds, objectIds });

describe('groupByPortfolio', () => {
  it('keys root Initiatives by Portfolio and lists the rest as unassigned', () => {
    const { byPortfolio, unassigned } = groupByPortfolio([p('A'), p('B')], [s('i1', 'A'), s('i2', 'B'), s('i3', null), s('i4', 'A')]);
    expect(byPortfolio.get('A')!.map((i) => i.id)).toEqual(['i1', 'i4']);
    expect(byPortfolio.get('B')!.map((i) => i.id)).toEqual(['i2']);
    expect(unassigned.map((i) => i.id)).toEqual(['i3']);
  });
  it('treats a Portfolio id that no longer exists as unassigned', () => {
    const { byPortfolio, unassigned } = groupByPortfolio([p('A')], [s('i1', 'gone')]);
    expect(byPortfolio.get('A')).toEqual([]);
    expect(unassigned.map((i) => i.id)).toEqual(['i1']);
  });
  it('leaves nested Initiatives to their parent', () => {
    const { byPortfolio, unassigned } = groupByPortfolio([p('A')], [s('root', 'A'), s('child', 'A', ['root']), s('orphanChild', null, ['x'])]);
    expect(byPortfolio.get('A')!.map((i) => i.id)).toEqual(['root']);
    expect(unassigned).toEqual([]);
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

describe('buildPortfolioTree', () => {
  const list = [p('B', null, 1), p('A', null, 0), p('A1', 'A', 0), p('A2', 'A', 1), p('A1x', 'A1', 0), p('lost', 'nope', 2)];
  it('nests by parent_id in sibling order and lifts orphans to the top level', () => {
    const tree = buildPortfolioTree(list);
    expect(tree.map((n) => n.portfolio.id)).toEqual(['A', 'B', 'lost']);
    expect(tree[0].children.map((n) => [n.portfolio.id, n.depth])).toEqual([['A1', 1], ['A2', 1]]);
    expect(tree[0].children[0].children[0].portfolio.id).toBe('A1x');
    expect(tree[0].children[0].children[0].depth).toBe(2);
  });
  it('flattens depth first and skips folded subtrees', () => {
    const tree = buildPortfolioTree(list);
    expect(flattenTree(tree, () => true).map((n) => n.portfolio.id)).toEqual(['A', 'A1', 'A1x', 'A2', 'B', 'lost']);
    expect(flattenTree(tree, (id) => id !== 'A1').map((n) => n.portfolio.id)).toEqual(['A', 'A1', 'A2', 'B', 'lost']);
  });
  it('lifts Portfolios caught in a parent loop so each appears exactly once', () => {
    const tree = buildPortfolioTree([p('A', 'B', 0), p('B', 'A', 1), p('C', null, 2), p('B1', 'B', 0)]);
    const all = flattenTree(tree, () => true).map((n) => n.portfolio.id);
    expect([...all].sort()).toEqual(['A', 'B', 'B1', 'C']);
    expect(new Set(all).size).toBe(all.length);
    expect(tree.map((n) => n.portfolio.id)).toContain('C');
  });
  it('knows a subtree and a path', () => {
    const tree = buildPortfolioTree(list);
    expect([...subtreeIds(tree[0])].sort()).toEqual(['A', 'A1', 'A1x', 'A2']);
    expect(portfolioPath(list, 'A1x').map((x) => x.id)).toEqual(['A', 'A1', 'A1x']);
    expect(portfolioPath(list, 'lost').map((x) => x.id)).toEqual(['lost']);
  });
});

describe('rollupPortfolio', () => {
  it('adds up the Portfolio and everything nested, averaging measured progress', () => {
    const tree = buildPortfolioTree([p('A'), p('A1', 'A')]);
    const byPortfolio = new Map([['A', [s('i1', 'A')]], ['A1', [s('i2', 'A1'), s('i3', 'A1')]]]);
    const health = new Map([
      ['i1', { progressPct: 50, risk: { overdue: 1, stalled: 0, blocked: 0 } }],
      ['i2', { progressPct: 100, risk: { overdue: 0, stalled: 2, blocked: 0 } }],
      ['i3', { progressPct: null, risk: { overdue: 0, stalled: 0, blocked: 0 } }],
    ]);
    expect(rollupPortfolio(tree[0], byPortfolio, health)).toEqual({ initiatives: 3, progressPct: 75, alerts: 3, pending: 0, measures: null });
    expect(rollupPortfolio(tree[0].children[0], byPortfolio, health)).toEqual({ initiatives: 2, progressPct: 100, alerts: 2, pending: 0, measures: null });
  });
  it('counts Initiatives whose health has not arrived', () => {
    const tree = buildPortfolioTree([p('A')]);
    expect(rollupPortfolio(tree[0], new Map([['A', [s('i1', 'A')]]]), new Map())).toEqual({ initiatives: 1, progressPct: null, alerts: 0, pending: 1, measures: null });
  });
  it('sums the success conditions of every Initiative underneath', () => {
    const tree = buildPortfolioTree([p('A'), p('A1', 'A')]);
    const byPortfolio = new Map([['A', [s('i1', 'A')]], ['A1', [s('i2', 'A1')]]]);
    const tallies = new Map([
      ['i1', { met: 1, missed: 2, unmeasured: 0, unstated: 0, total: 3 }],
      ['i2', { met: 0, missed: 1, unmeasured: 1, unstated: 1, total: 3 }],
    ]);
    expect(rollupPortfolio(tree[0], byPortfolio, new Map(), tallies).measures)
      .toEqual({ met: 1, missed: 3, unmeasured: 1, unstated: 1, total: 6 });
  });
  it('holds the condition sum back until every Initiative has loaded', () => {
    const tree = buildPortfolioTree([p('A')]);
    const byPortfolio = new Map([['A', [s('i1', 'A'), s('i2', 'A')]]]);
    const partial = new Map([['i1', { met: 0, missed: 2, unmeasured: 0, unstated: 0, total: 2 }]]);
    expect(rollupPortfolio(tree[0], byPortfolio, new Map(), partial).measures).toBeNull();
    expect(rollupPortfolio(buildPortfolioTree([p('B')])[0], new Map(), new Map()).measures).toEqual({ met: 0, missed: 0, unmeasured: 0, unstated: 0, total: 0 });
  });
});

describe('initiativesOfVision', () => {
  it('splits root Initiatives into this Vision\'s and the unplaced, leaving other Visions\' out', () => {
    const { inVision, unplaced } = initiativesOfVision(
      [s('mine', null, [], [], 'v1'), s('other', null, [], [], 'v2'), s('loose', null, [], [], null), s('nested', null, ['mine'], [], 'v1')],
      'v1');
    expect(inVision.map((i) => i.id)).toEqual(['mine']);
    expect(unplaced.map((i) => i.id)).toEqual(['loose']);
  });
});

describe('an Initiative with a Space of its own is placed by it', () => {
  const base = { name: 'x', portfolio_id: null, vision_id: null, parentIds: [] as string[], objectIds: [] as string[] };
  it('lists only this Space’s Initiatives; one without a Space falls back to its Objects', () => {
    const here = { ...base, id: 'here', activity_space_id: 'S1' };
    const there = { ...base, id: 'there', activity_space_id: 'S2', objectIds: ['o1'] };
    const legacy = { ...base, id: 'legacy', activity_space_id: null, objectIds: ['o1'] };
    const objectDomain = new Map<string, string | null>([['o1', 'd1']]);
    expect(initiativesInSpace([here, there, legacy], objectDomain, new Set(['d1']), 'S1').map((s) => s.id)).toEqual(['here', 'legacy']);
  });
  it('keeps another Space’s loose Initiatives out of this Vision’s unplaced list', () => {
    const mine = { ...base, id: 'mine', activity_space_id: 'S1' };
    const theirs = { ...base, id: 'theirs', activity_space_id: 'S2' };
    expect(initiativesOfVision([mine, theirs], 'v1', 'S1').unplaced.map((s) => s.id)).toEqual(['mine']);
  });
});

describe('the Strategy list of a Space', () => {
  it('keeps the viewer’s other Spaces’ Initiatives out, but not ones shared through an Object', async () => {
    const { showsInSpace } = await import('@/Function/strategy/initiativeAccess');
    const mine = ['S1', 'S2'];
    expect(showsInSpace({ activity_space_id: 'S1' }, 'S1', mine)).toBe(true);
    expect(showsInSpace({ activity_space_id: 'S2' }, 'S1', mine)).toBe(false);
    expect(showsInSpace({ activity_space_id: 'S9' }, 'S1', mine)).toBe(true);
    expect(showsInSpace({ activity_space_id: null }, 'S1', mine)).toBe(true);
  });
});
