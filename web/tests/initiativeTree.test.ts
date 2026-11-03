import { describe, expect, it } from 'vitest';
import { buildInitiativeTree, flattenInitiativeTree, initiativesInSpace } from '../src/ActivitySpace/strategy/initiative/initiativeTree';

const s = (id: string, parentIds: string[] = [], objectIds: string[] = [], created_at = '2026-11-01T00:00:00Z') =>
  ({ id, name: id, vision_id: null, parentIds, objectIds, created_at });

describe('initiativesInSpace', () => {
  const objectDomain = new Map<string, string | null>([['o1', 'd1'], ['o2', 'd2'], ['o3', null]]);
  it("keeps Initiatives with an Object in one of the Space's Domains, and Object-less ones", () => {
    const kept = initiativesInSpace(
      [s('here', [], ['o1']), s('elsewhere', [], ['o2']), s('fresh'), s('mixed', [], ['o2', 'o1']), s('undomained', [], ['o3'])],
      objectDomain, new Set(['d1']));
    expect(kept.map((i) => i.id)).toEqual(['here', 'fresh', 'mixed']);
  });
  it('answers from the Initiative’s own Space when it has one', () => {
    const own = { ...s('own', [], ['o2']), activity_space_id: 'sp' };
    const other = { ...s('other'), activity_space_id: 'sp2' };
    expect(initiativesInSpace([own, other], objectDomain, new Set(['d1']), 'sp').map((i) => i.id)).toEqual(['own']);
  });
});

describe('buildInitiativeTree', () => {
  const list = [
    s('B', [], [], '2026-11-02T00:00:00Z'), s('A', [], [], '2026-11-01T00:00:00Z'),
    s('A1', ['A'], [], '2026-11-03T00:00:00Z'), s('A2', ['A'], [], '2026-11-04T00:00:00Z'),
    s('A1x', ['A1']), s('lost', ['gone']),
  ];
  it('nests by parent, oldest first, and keeps one whose parent is missing at the top', () => {
    const tree = buildInitiativeTree(list);
    expect(tree.map((n) => n.initiative.id)).toEqual(['A', 'lost', 'B']);
    const a = tree.find((n) => n.initiative.id === 'A')!;
    expect(a.children.map((n) => [n.initiative.id, n.depth])).toEqual([['A1', 1], ['A2', 1]]);
    expect(a.children[0].children[0].initiative.id).toBe('A1x');
    expect(a.children[0].children[0].key).toBe('A/A1/A1x');
  });
  it('flattens depth first and skips folded rows', () => {
    const tree = buildInitiativeTree(list);
    expect(flattenInitiativeTree(tree, () => true).map((n) => n.initiative.id)).toEqual(['A', 'A1', 'A1x', 'A2', 'lost', 'B']);
    expect(flattenInitiativeTree(tree, (key) => key !== 'A/A1').map((n) => n.initiative.id)).toEqual(['A', 'A1', 'A2', 'lost', 'B']);
  });
  it('shows an Initiative under each of its parents', () => {
    const tree = buildInitiativeTree([s('P'), s('Q'), s('shared', ['P', 'Q'])]);
    expect(flattenInitiativeTree(tree, () => true).map((n) => n.key)).toEqual(['P', 'P/shared', 'Q', 'Q/shared']);
  });
  it('lifts Initiatives caught in a loop so each appears', () => {
    const tree = buildInitiativeTree([s('X', ['Y']), s('Y', ['X']), s('C')]);
    const all = flattenInitiativeTree(tree, () => true).map((n) => n.initiative.id);
    expect(new Set(all)).toEqual(new Set(['X', 'Y', 'C']));
    expect(all.length).toBe(3);
  });
});
