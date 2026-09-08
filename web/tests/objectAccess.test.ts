import { describe, it, expect } from 'vitest';
import { canEditObject, canManageDomainTypes } from '../src/ActivitySpace/execution/object/objectAccess';

describe('canEditObject', () => {
  it('only members edit', () => {
    expect(canEditObject(new Set(['o1']), 'o1')).toBe(true);
    expect(canEditObject(new Set(['o1']), 'o2')).toBe(false);
    expect(canEditObject(new Set(), 'o1')).toBe(false);
  });
  it('unknown memberships allow — RLS and rollback still guard, and a control must not flicker', () => {
    expect(canEditObject(undefined, 'o1')).toBe(true);
  });
});

describe('canManageDomainTypes', () => {
  it('owner or admin of the Domain, nobody without a Domain', () => {
    const roles = new Map([['d1', 'owner'], ['d2', 'member'], ['d3', 'admin']]);
    expect(canManageDomainTypes(roles, 'd1')).toBe(true);
    expect(canManageDomainTypes(roles, 'd3')).toBe(true);
    expect(canManageDomainTypes(roles, 'd2')).toBe(false);
    expect(canManageDomainTypes(roles, 'd9')).toBe(false);
    expect(canManageDomainTypes(roles, null)).toBe(false);
    expect(canManageDomainTypes(undefined, 'd1')).toBe(true);
  });
});
