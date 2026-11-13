import { describe, expect, it } from 'vitest';

const { basisIds, basisRelationship, MAX_BASIS } = await import(new URL('../../supabase/functions/_shared/elementBasis.ts', import.meta.url).pathname);

describe('elementBasis', () => {
  it('serves a measure or a decision, tests a premise, and takes no other kind as a reason', () => {
    expect(basisRelationship('measure')).toBe('delivers');
    expect(basisRelationship('decision')).toBe('delivers');
    expect(basisRelationship('assumption')).toBe('tests');
    expect(basisRelationship('master')).toBeNull();
    expect(basisRelationship(undefined)).toBeNull();
  });

  it('reads the ids a caller passed: strings, trimmed, once each, capped', () => {
    expect(basisIds(['a', ' a ', 'b', 3, '', null])).toEqual(['a', 'b']);
    expect(basisIds('a')).toEqual([]);
    expect(basisIds(undefined)).toEqual([]);
    expect(basisIds(Array.from({ length: MAX_BASIS + 5 }, (_, i) => `i${i}`))).toHaveLength(MAX_BASIS);
  });
});
