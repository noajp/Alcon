import { describe, expect, it } from 'vitest';
import { descendantObjects } from '@/ActivitySpace/strategy/initiative/initiativeTree';

const s = (id: string, parentIds: string[], objectIds: string[]) => ({ id, name: id.toUpperCase(), parentIds, objectIds });

describe('descendantObjects', () => {
  it('collects the subtree’s Objects with the Strategy that holds them', () => {
    const all = [s('root', [], ['o0']), s('a', ['root'], ['o1']), s('b', ['root'], []), s('b1', ['b'], ['o2'])];
    const got = descendantObjects(all, 'root');
    expect([...got.entries()]).toEqual([['o1', { id: 'a', name: 'A' }], ['o2', { id: 'b1', name: 'B1' }]]);
  });
  it('leaves out the Strategy’s own Objects and prefers the nearer holder', () => {
    const all = [s('root', [], ['o0']), s('a', ['root'], ['o0', 'o1']), s('a1', ['a'], ['o1'])];
    expect([...descendantObjects(all, 'root').entries()]).toEqual([['o1', { id: 'a', name: 'A' }]]);
  });
  it('does not follow a loop', () => {
    const all = [s('root', ['a'], []), s('a', ['root'], ['o1'])];
    expect([...descendantObjects(all, 'root').keys()]).toEqual(['o1']);
  });
});
