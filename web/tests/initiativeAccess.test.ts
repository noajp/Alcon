import { describe, it, expect } from 'vitest';
import { canEditInitiative } from '../src/ActivitySpace/strategy/initiative/initiativeAccess';

describe('canEditInitiative', () => {
  it('only the creator edits', () => {
    expect(canEditInitiative('u1', 'u1')).toBe(true);
    expect(canEditInitiative('u2', 'u1')).toBe(false);
  });
  it('nobody edits an Initiative with no recorded creator, and a signed-out viewer edits nothing', () => {
    expect(canEditInitiative('u1', null)).toBe(false);
    expect(canEditInitiative(null, 'u1')).toBe(false);
    expect(canEditInitiative(undefined, undefined)).toBe(false);
  });
});
