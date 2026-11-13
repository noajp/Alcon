import { describe, expect, it } from 'vitest';

const { basisErrorText, basisIds, basisRelationship, MAX_BASIS } = await import(new URL('../../supabase/functions/_shared/elementBasis.ts', import.meta.url).pathname);

describe('elementBasis', () => {
  it('serves a measure or a decision, tests a premise, and takes no other kind as a reason', () => {
    expect(basisRelationship('measure')).toBe('delivers');
    expect(basisRelationship('decision')).toBe('delivers');
    expect(basisRelationship('assumption')).toBe('tests');
    expect(basisRelationship('master')).toBeNull();
    expect(basisRelationship(undefined)).toBeNull();
  });

  it('reads the ids a caller passed: strings, trimmed, once each', () => {
    expect(basisIds(['a', ' a ', 'b', 3, '', null])).toEqual({ ids: ['a', 'b'], overflow: [] });
    expect(basisIds('a')).toEqual({ ids: [], overflow: [] });
    expect(basisIds(undefined)).toEqual({ ids: [], overflow: [] });
  });

  it('hands back the ids past the cap instead of dropping them', () => {
    const many = Array.from({ length: MAX_BASIS + 2 }, (_, i) => `i${i}`);
    const { ids, overflow } = basisIds(many);
    expect(ids).toHaveLength(MAX_BASIS);
    expect(overflow).toEqual([`i${MAX_BASIS}`, `i${MAX_BASIS + 1}`]);
  });

  it('names every refused id with its own reason, and nothing when all bound', () => {
    expect(basisErrorText([])).toBeUndefined();
    expect(basisErrorText([{ id: 'x', reason: 'not an intent id' }, { id: 'y', reason: 'replaced by a newer version' }]))
      .toBe('Not bound as the reason: x (not an intent id), y (replaced by a newer version)');
  });
});
