// ⌘K finds the open Space's Elements only — as it does CRM records — and keeps
// each one's Domain so opening it can switch there first.

import { describe, expect, it } from 'vitest';

import { elementSearchResults, type ElementSearchRow } from '@/Function/shared/elementSearch';

const row = (id: string, spaceId: string | null, domainId = `d-${id}`): ElementSearchRow => ({
  id,
  title: `Element ${id}`,
  description: null,
  object_id: `o-${id}`,
  display_id: `ELE_MED-${id}`,
  object: { domain_id: domainId, domain: spaceId ? { activity_space_id: spaceId } : null },
});

describe('elementSearchResults', () => {
  it('keeps only Elements whose Domain is in the open Space', () => {
    const out = elementSearchResults([row('001', 'space-a'), row('002', 'space-b'), row('003', 'space-a')], 'space-a');
    expect(out.map(r => r.id)).toEqual(['001', '003']);
  });

  it('drops Elements whose Object or Domain is not visible', () => {
    const noObject = { ...row('004', 'space-a'), object: null };
    expect(elementSearchResults([noObject, row('005', null)], 'space-a')).toEqual([]);
  });

  it('finds nothing without an open Space', () => {
    expect(elementSearchResults([row('001', 'space-a')], null)).toEqual([]);
  });

  it('carries the Domain to open and the quotable id', () => {
    expect(elementSearchResults([row('001', 'space-a', 'domain-x')], 'space-a')).toEqual([{
      kind: 'element', id: '001', title: 'Element 001', snippet: null,
      objectId: 'o-001', domainId: 'domain-x', displayId: 'MED-001',
    }]);
  });
});
