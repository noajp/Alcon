import { describe, expect, it } from 'vitest';
import { diffLinks } from '@/hooks/strategyData';

describe('an Initiative’s Objects change by difference', () => {
  it('adds only the new links and drops only the gone ones', () => {
    expect(diffLinks(['a', 'b'], ['b', 'c'])).toEqual({ toAdd: ['c'], toRemove: ['a'] });
  });
  it('writes nothing when nothing changed, in any order', () => {
    expect(diffLinks(['a', 'b'], ['b', 'a'])).toEqual({ toAdd: [], toRemove: [] });
  });
  it('clears every link when the new set is empty, and ignores repeats', () => {
    expect(diffLinks(['a'], [])).toEqual({ toAdd: [], toRemove: ['a'] });
    expect(diffLinks([], ['a', 'a'])).toEqual({ toAdd: ['a'], toRemove: [] });
  });
});
