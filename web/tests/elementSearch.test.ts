// ⌘K finds the open Space's Elements only, and keeps
// each one's Domain so opening it can switch there first. The viewer's own
// personal Elements belong to no Space and are found from every Space.

import { describe, expect, it } from 'vitest';

import { elementSearchResults, type ElementSearchRow } from '@/Function/shared/elementSearch';

const row = (id: string, spaceId: string | null, domainId = `d-${id}`): ElementSearchRow => ({
  id,
  title: `Element ${id}`,
  description: null,
  object_id: `o-${id}`,
  owner_id: null,
  display_id: `ELE_MED-${id}`,
  object: { domain_id: domainId, domain: spaceId ? { activity_space_id: spaceId } : null },
});

const personal = (id: string, ownerId: string): ElementSearchRow => ({
  id, title: `Mine ${id}`, description: null, object_id: null, owner_id: ownerId, display_id: null,
});

describe('elementSearchResults', () => {
  it('keeps only Elements whose Domain is in the open Space', () => {
    const out = elementSearchResults([row('001', 'space-a'), row('002', 'space-b'), row('003', 'space-a')], 'space-a', 'me');
    expect(out.map(r => r.id)).toEqual(['001', '003']);
  });

  it('drops Space Elements whose Object or Domain is not visible', () => {
    const noObject = { ...row('004', 'space-a'), object: null };
    expect(elementSearchResults([noObject, row('005', null)], 'space-a', 'me')).toEqual([]);
  });

  it("keeps the viewer's own personal Elements in any Space, and nobody else's", () => {
    const out = elementSearchResults([personal('p1', 'me'), personal('p2', 'someone')], 'space-a', 'me');
    expect(out).toEqual([{ kind: 'element', id: 'p1', title: 'Mine p1', snippet: null, objectId: null, domainId: null, displayId: null }]);
    expect(elementSearchResults([personal('p1', 'me')], null, 'me').map(r => r.id)).toEqual(['p1']);
    expect(elementSearchResults([personal('p1', 'me')], 'space-a', null)).toEqual([]);
  });

  it('finds no Space Elements without an open Space', () => {
    expect(elementSearchResults([row('001', 'space-a')], null, 'me')).toEqual([]);
  });

  it('lists an Element once when both queries return it', () => {
    expect(elementSearchResults([personal('p1', 'me'), personal('p1', 'me')], 'space-a', 'me')).toHaveLength(1);
  });

  it('carries the Domain to open and the quotable id', () => {
    expect(elementSearchResults([row('001', 'space-a', 'domain-x')], 'space-a', 'me')).toEqual([{
      kind: 'element', id: '001', title: 'Element 001', snippet: null,
      objectId: 'o-001', domainId: 'domain-x', displayId: 'MED-001',
    }]);
  });
});
