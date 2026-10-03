import { describe, it, expect } from 'vitest';
import {
  archiveStateChanged,
  canManageObject,
  countActiveObjects,
  domainObjectsRefusal,
  isArchivedObject,
  onlyActiveObjects,
} from '../src/Function/shared/objectArchive';

describe('isArchivedObject', () => {
  it('is archived only when archived_at is set', () => {
    expect(isArchivedObject({ archived_at: '2026-10-03T00:00:00Z' })).toBe(true);
    expect(isArchivedObject({ archived_at: null })).toBe(false);
    expect(isArchivedObject({})).toBe(false);
    expect(isArchivedObject(null)).toBe(false);
  });
});

describe('onlyActiveObjects', () => {
  it('filters on archived_at is null and keeps the builder', () => {
    const calls: [string, null][] = [];
    const builder = { is(column: string, value: null) { calls.push([column, value]); return builder; } };
    expect(onlyActiveObjects(builder)).toBe(builder);
    expect(calls).toEqual([['archived_at', null]]);
  });
});

describe('canManageObject', () => {
  const domainRoles = new Map([['d-own', 'owner'], ['d-admin', 'admin'], ['d-member', 'member']]);
  const objectRoles = new Map([['o-own', 'owner'], ['o-member', 'member']]);

  it('decides by the primary Domain when the Object has one', () => {
    expect(canManageObject(domainRoles, objectRoles, { id: 'o-member', domain_id: 'd-own' })).toBe(true);
    expect(canManageObject(domainRoles, objectRoles, { id: 'o-member', domain_id: 'd-admin' })).toBe(true);
    // Owning the Object does not manage it while it sits in a Domain.
    expect(canManageObject(domainRoles, objectRoles, { id: 'o-own', domain_id: 'd-member' })).toBe(false);
    expect(canManageObject(domainRoles, objectRoles, { id: 'o-own', domain_id: 'd-other' })).toBe(false);
  });

  it('decides by the Object itself when it has no Domain', () => {
    expect(canManageObject(domainRoles, objectRoles, { id: 'o-own', domain_id: null })).toBe(true);
    expect(canManageObject(domainRoles, objectRoles, { id: 'o-member', domain_id: null })).toBe(false);
  });

  it('treats roles still loading as allowed', () => {
    expect(canManageObject(undefined, objectRoles, { id: 'x', domain_id: 'd-member' })).toBe(true);
    expect(canManageObject(domainRoles, undefined, { id: 'x', domain_id: null })).toBe(true);
  });
});

describe('countActiveObjects', () => {
  it('counts only linked Objects the active list holds, once each', () => {
    const active = new Set(['o1', 'o2']);
    expect(countActiveObjects(['o1', 'o2', 'o3'], active)).toBe(2);
    expect(countActiveObjects(['o1', 'o1'], active)).toBe(1);
    expect(countActiveObjects([], active)).toBe(0);
    expect(countActiveObjects(['o3'], new Set())).toBe(0);
  });
});

describe('archiveStateChanged', () => {
  const active = { objects: [{ id: 'o1', archived_at: null }] };
  const archived = { objects: [{ id: 'o1', archived_at: '2026-10-03T00:00:00Z' }] };
  it('is true when a cached copy disagrees', () => {
    expect(archiveStateChanged([active], 'o1', '2026-10-03T00:00:00Z')).toBe(true);
    // A restore seen through the Archived list or the Object opened by id.
    expect(archiveStateChanged([archived], 'o1', null)).toBe(true);
    expect(archiveStateChanged([{ objects: [] }, archived], 'o1', null)).toBe(true);
  });
  it('is true for an archived row no cache holds — its Elements may be in My Elements or Now', () => {
    expect(archiveStateChanged([active], 'o2', '2026-10-03T00:00:00Z')).toBe(true);
    expect(archiveStateChanged([], 'o1', '2026-10-03T00:00:00Z')).toBe(true);
  });
  it('is false when the copies agree, or for an active row no cache holds', () => {
    expect(archiveStateChanged([active], 'o1', null)).toBe(false);
    expect(archiveStateChanged([archived], 'o1', '2026-10-04T00:00:00Z')).toBe(false);
    expect(archiveStateChanged([active], 'o2', null)).toBe(false);
    expect(archiveStateChanged([], 'o1', null)).toBe(false);
  });
});

describe('domainObjectsRefusal', () => {
  it('reads the count from the guard refusal', () => {
    expect(domainObjectsRefusal({ code: '23503', hint: 'domain_has_objects', details: '3' })).toBe(3);
    expect(domainObjectsRefusal({ code: '23503', hint: 'domain_has_objects', details: null })).toBe(1);
  });

  it('ignores other errors', () => {
    expect(domainObjectsRefusal({ code: '23503', hint: null, details: '3' })).toBeNull();
    expect(domainObjectsRefusal({ code: '42501', hint: 'domain_has_objects' })).toBeNull();
    expect(domainObjectsRefusal(new Error('x'))).toBeNull();
    expect(domainObjectsRefusal(null)).toBeNull();
  });
});
