import { describe, it, expect } from 'vitest';
import { canEditObject, canManageDomainTypes, isViewOnly } from '../src/ActivitySpace/execution/object/objectAccess';

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

describe('isViewOnly', () => {
  it('a Domain viewer is view-only, except in an Object they belong to', () => {
    expect(isViewOnly('viewer')).toBe(true);
    expect(isViewOnly('viewer', new Set(['o1']), 'o2')).toBe(true);
    expect(isViewOnly('viewer', new Set(['o1']), 'o1')).toBe(false);
  });
  it('members, admins, owners, people without a row and unknown roles are not', () => {
    for (const role of ['owner', 'admin', 'member', null, undefined]) expect(isViewOnly(role)).toBe(false);
  });
});
