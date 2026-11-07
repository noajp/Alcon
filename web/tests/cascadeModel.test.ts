import { describe, expect, it } from 'vitest';
import { cascadeLevels, type CascadeNode } from '@/ActivitySpace/strategy/initiative/cascadeModel';

const node = (id: string, parentIds: string[] = []): CascadeNode => ({ id, parentIds });

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
