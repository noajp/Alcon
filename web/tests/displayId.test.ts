// The Element id every surface shows.
//
// A row and the dependency tooltip pointing at that row must name the same
// work identically — "el_MED-001 is waiting on el_PH1-004" is readable, two
// different naming schemes are not. So there is one rule, and it has one home:
// the quotable display_id, or nothing at all. Anything derived from the
// per-Object seq_number would name a different row in every Object.

import { describe, expect, it } from 'vitest';

import { displayIdOf } from '@/alcon/element/displayId';
import { describeBlocker } from '@/alcon/element/dependencyReadiness';

describe('displayIdOf', () => {
  it('returns the display_id when the row has one', () => {
    expect(displayIdOf({ display_id: 'el_MED-001' })).toBe('el_MED-001');
    expect(displayIdOf({ display_id: 'sub_MED-001-01' })).toBe('sub_MED-001-01');
  });

  it('returns null when there is no id to quote', () => {
    // An Element inserted optimistically has no display_id until the trigger
    // backfills it; the column is nullable for older rows too.
    expect(displayIdOf({ display_id: null })).toBeNull();
    expect(displayIdOf({})).toBeNull();
  });

  it('treats a blank id as no id', () => {
    expect(displayIdOf({ display_id: '' })).toBeNull();
    expect(displayIdOf({ display_id: '   ' })).toBeNull();
  });

  it('ignores seq_number, which is not an id', () => {
    // A per-Object counter is not quotable; a row carrying one still has no id.
    const row = { display_id: null, seq_number: 4 };
    expect(displayIdOf(row)).toBeNull();
  });
});

describe('describeBlocker', () => {
  it('names a blocker by the same id the row shows', () => {
    expect(describeBlocker({
      id: 'a', title: 'Ship the API', display_id: 'el_MED-001', status: 'todo',
    })).toBe('el_MED-001 Ship the API');
  });

  it('falls back to the title alone, matching a row with no id', () => {
    expect(describeBlocker({
      id: 'a', title: 'Ship the API', display_id: null, status: 'todo',
    })).toBe('Ship the API');
    expect(describeBlocker({
      id: 'a', title: 'Ship the API', display_id: '  ', status: 'todo',
    })).toBe('Ship the API');
  });
});
