import { describe, expect, it } from 'vitest';
import {
  ancestorLevels,
  cascadeLevels,
  cascadeLineage,
  cascadeObjectChips,
  CASCADE_OBJECT_CHIP_CAP,
  type CascadeNode,
  type CascadeObjectRef,
} from '@/ActivitySpace/strategy/initiative/cascadeModel';

const node = (id: string, parentIds: string[] = []): CascadeNode => ({ id, parentIds });

const objectRef = (id: string): CascadeObjectRef => ({ id, name: `Object ${id}`, icon: null, color: null, domain_id: 'dom-1' });
const objectsById = (ids: string[]) => new Map(ids.map((id) => [id, objectRef(id)] as const));

describe('cascadeLevels', () => {
  it('reads a linear chain one level at a time', () => {
    const strategies = [node('a'), node('b', ['a']), node('c', ['b']), node('d', ['c'])];
    expect(cascadeLevels('a', strategies)).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('fans branching children into one level, in input order', () => {
    const strategies = [node('root'), node('b', ['root']), node('c', ['root']), node('d', ['b']), node('e', ['c'])];
    expect(cascadeLevels('root', strategies)).toEqual([['root'], ['b', 'c'], ['d', 'e']]);
  });

  it('places a multi-parent child once, at its shallowest depth', () => {
    // 'shared' hangs under both the child 'mid' and the root itself; the
    // root's direct edge is the shallower one, so it lands at level 1 and
    // is not repeated when 'mid' is descended.
    const strategies = [node('root'), node('mid', ['root']), node('shared', ['mid', 'root']), node('leaf', ['shared'])];
    expect(cascadeLevels('root', strategies)).toEqual([['root'], ['mid', 'shared'], ['leaf']]);
  });

  it('cannot loop on a cycle', () => {
    const strategies = [node('a', ['c']), node('b', ['a']), node('c', ['b'])];
    expect(cascadeLevels('a', strategies)).toEqual([['a'], ['b'], ['c']]);
  });

  it('stands the root alone when it has no children', () => {
    const strategies = [node('a'), node('unrelated')];
    expect(cascadeLevels('a', strategies)).toEqual([['a']]);
  });

  it('leaves out Strategies the descent never reaches', () => {
    const strategies = [node('a'), node('b', ['a']), node('other'), node('other-child', ['other'])];
    expect(cascadeLevels('a', strategies)).toEqual([['a'], ['b']]);
  });

  it('is empty for a root the input does not contain', () => {
    expect(cascadeLevels('missing', [node('a')])).toEqual([]);
  });
});

describe('ancestorLevels', () => {
  it('reads a linear chain upward one level at a time', () => {
    const strategies = [node('a'), node('b', ['a']), node('c', ['b']), node('d', ['c'])];
    expect(ancestorLevels('d', strategies)).toEqual([['c'], ['b'], ['a']]);
  });

  it('fans multiple parents into one level, in input order', () => {
    // 'x' lists p2 before p1 in its parentIds, but the level follows the
    // input's order, as the descent's levels do.
    const strategies = [node('top'), node('p1', ['top']), node('p2', ['top']), node('x', ['p2', 'p1'])];
    expect(ancestorLevels('x', strategies)).toEqual([['p1', 'p2'], ['top']]);
  });

  it('places a multi-distance ancestor once, at its shallowest distance', () => {
    // 'gp' is both the root's parent and its grandparent (through 'p');
    // the direct edge is the shallower one, so it stands at level 0 and
    // is not repeated as a grandparent.
    const strategies = [node('gp'), node('p', ['gp']), node('root', ['p', 'gp'])];
    expect(ancestorLevels('root', strategies)).toEqual([['gp', 'p']]);
  });

  it('cannot loop on a cycle', () => {
    const strategies = [node('a', ['c']), node('b', ['a']), node('c', ['b'])];
    expect(ancestorLevels('a', strategies)).toEqual([['c'], ['b']]);
  });

  it('is empty for a root with no parents', () => {
    const strategies = [node('a'), node('b', ['a'])];
    expect(ancestorLevels('a', strategies)).toEqual([]);
  });

  it('is empty for a root the input does not contain', () => {
    expect(ancestorLevels('missing', [node('a')])).toEqual([]);
  });
});

describe('cascadeLineage', () => {
  it('orders the full lineage root-first: ancestors, self, descendants', () => {
    const strategies = [node('a'), node('b', ['a']), node('c', ['b']), node('d', ['c'])];
    expect(cascadeLineage('c', strategies)).toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  it('stands the root alone when it has no parents and no children', () => {
    const strategies = [node('a'), node('unrelated')];
    expect(cascadeLineage('a', strategies)).toEqual([['a']]);
  });

  it('reads a top-level Strategy exactly as the descent does', () => {
    const strategies = [node('root'), node('b', ['root']), node('c', ['root']), node('d', ['b'])];
    expect(cascadeLineage('root', strategies)).toEqual(cascadeLevels('root', strategies));
  });

  it('places a Strategy reachable both up and down once, on the ancestor side', () => {
    // A cross-linked cycle: 'x' is the root's parent, and the descent
    // from the root reaches 'x' again through 'c'. The ancestor side
    // wins; no level repeats it downward.
    const strategies = [node('r', ['x']), node('c', ['r']), node('x', ['c'])];
    expect(cascadeLineage('r', strategies)).toEqual([['c'], ['x'], ['r']]);
  });

  it('keeps the rest of a descendant level when one member was claimed upward', () => {
    // 'a' is the root's parent and also hangs under 'k', below the root;
    // its level-mate 'w' still stands in the descent.
    const strategies = [node('a', ['k']), node('r', ['a']), node('k', ['r']), node('w', ['k'])];
    expect(cascadeLineage('r', strategies)).toEqual([['k'], ['a'], ['r'], ['w']]);
  });

  it('is empty for a root the input does not contain', () => {
    expect(cascadeLineage('missing', [node('a')])).toEqual([]);
  });
});

describe('cascadeObjectChips', () => {
  it('resolves the chips in the junction order, not the rows order', () => {
    const byId = objectsById(['a', 'b', 'c']);
    const { chips, overflow } = cascadeObjectChips(['c', 'a', 'b'], byId);
    expect(chips.map((o) => o.id)).toEqual(['c', 'a', 'b']);
    expect(overflow).toBe(0);
  });

  it('skips an Object id with no matching row, silently', () => {
    const byId = objectsById(['a', 'b']);
    const { chips, overflow } = cascadeObjectChips(['a', 'gone', 'b'], byId);
    expect(chips.map((o) => o.id)).toEqual(['a', 'b']);
    expect(overflow).toBe(0);
  });

  it('stands a repeated id once, at its first place', () => {
    const byId = objectsById(['a', 'b']);
    const { chips, overflow } = cascadeObjectChips(['a', 'b', 'a'], byId);
    expect(chips.map((o) => o.id)).toEqual(['a', 'b']);
    expect(overflow).toBe(0);
  });

  it('caps at the default and counts the rest as overflow', () => {
    const ids = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'o8'];
    const { chips, overflow } = cascadeObjectChips(ids, objectsById(ids));
    expect(CASCADE_OBJECT_CHIP_CAP).toBe(6);
    expect(chips.map((o) => o.id)).toEqual(ids.slice(0, CASCADE_OBJECT_CHIP_CAP));
    expect(overflow).toBe(2);
  });

  it('counts no overflow at exactly the cap', () => {
    const ids = ['o1', 'o2', 'o3', 'o4', 'o5', 'o6'];
    const { chips, overflow } = cascadeObjectChips(ids, objectsById(ids));
    expect(chips).toHaveLength(6);
    expect(overflow).toBe(0);
  });

  it('honours a caller-given cap', () => {
    const byId = objectsById(['a', 'b', 'c']);
    const { chips, overflow } = cascadeObjectChips(['a', 'b', 'c'], byId, 2);
    expect(chips.map((o) => o.id)).toEqual(['a', 'b']);
    expect(overflow).toBe(1);
  });

  it('is empty when the Strategy holds no Objects', () => {
    expect(cascadeObjectChips([], objectsById(['a']))).toEqual({ chips: [], overflow: 0 });
  });
});
