import { describe, it, expect } from 'vitest';
import { canEditInitiative } from '@/Function/strategy/initiativeAccess';

describe('canEditInitiative', () => {
  it('only the creator edits', () => {
    expect(canEditInitiative('u1', 'u1')).toBe(true);
    expect(canEditInitiative('u2', 'u1')).toBe(false);
  });
  it('an owner of the Strategy’s Space edits it too', () => {
    expect(canEditInitiative('u2', 'u1', true)).toBe(true);
    expect(canEditInitiative(null, 'u1', true)).toBe(false);
  });
  it('nobody edits a Strategy with no recorded creator, and a signed-out viewer edits nothing', () => {
    expect(canEditInitiative('u1', null)).toBe(false);
    expect(canEditInitiative(null, 'u1')).toBe(false);
    expect(canEditInitiative(undefined, undefined)).toBe(false);
  });
});
