import { describe, expect, it } from 'vitest';
import { uniformIdWidth } from '@/Function/shared/listTable/useUniformIdWidth';

describe('uniformIdWidth', () => {
  it('takes the widest id, rounded up to a whole pixel', () => {
    expect(uniformIdWidth([41.2, 55.01, 48], 144)).toBe(56);
  });

  it('caps a runaway id so it cannot push every title off screen', () => {
    expect(uniformIdWidth([40, 310], 144)).toBe(144);
  });

  it('returns null when nothing was measured, so chips keep their fallback', () => {
    expect(uniformIdWidth([], 144)).toBeNull();
    expect(uniformIdWidth([0, Number.NaN], 144)).toBeNull();
  });
});
