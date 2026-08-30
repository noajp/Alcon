import { describe, expect, it } from 'vitest';
import { normalizeDirection } from '@/types/database';

// normalizeDirection is the only thing standing between `elements.direction`
// (an unvalidated jsonb column) and every reader of a Direction. Its contract:
// hand back either null or a fully-populated ElementDirection — never a
// half-shaped object that makes a caller reach for `?.` or crash on
// `.acceptance.map`.

describe('normalizeDirection — absent or wrong-shaped input yields null', () => {
  it('returns null for null and undefined', () => {
    expect(normalizeDirection(null)).toBeNull();
    expect(normalizeDirection(undefined)).toBeNull();
  });

  it('returns null for primitives that are not objects', () => {
    expect(normalizeDirection('approach')).toBeNull();
    expect(normalizeDirection(42)).toBeNull();
    expect(normalizeDirection(true)).toBeNull();
  });

  it('returns null for an array — a Direction is an object, not a list', () => {
    expect(normalizeDirection([])).toBeNull();
    expect(normalizeDirection([{ approach: 'a', acceptance: [], next: null }])).toBeNull();
  });
});

describe('normalizeDirection — every returned Direction is complete', () => {
  it('fills all three keys when the jsonb is empty', () => {
    expect(normalizeDirection({})).toEqual({ approach: null, acceptance: [], next: null });
  });

  it('fills only the missing keys, keeping the present ones', () => {
    expect(normalizeDirection({ approach: 'Ship behind a flag' })).toEqual({
      approach: 'Ship behind a flag',
      acceptance: [],
      next: null,
    });
    expect(normalizeDirection({ next: 'Draft the migration' })).toEqual({
      approach: null,
      acceptance: [],
      next: 'Draft the migration',
    });
  });

  it('passes a fully-populated Direction through unchanged', () => {
    expect(
      normalizeDirection({
        approach: 'Extract the rules first',
        acceptance: ['CI is red on a violation', 'the allowlist still passes'],
        next: 'Write the extraction',
      }),
    ).toEqual({
      approach: 'Extract the rules first',
      acceptance: ['CI is red on a violation', 'the allowlist still passes'],
      next: 'Write the extraction',
    });
  });

  it('drops non-string approach/next rather than leaking the raw value', () => {
    expect(normalizeDirection({ approach: 7, next: { text: 'nope' } })).toEqual({
      approach: null,
      acceptance: [],
      next: null,
    });
  });
});

/** The acceptance list of a Direction that must normalize to something. */
function acceptanceOf(raw: unknown): string[] {
  const direction = normalizeDirection(raw);
  if (!direction) throw new Error('expected an object input to normalize to a Direction');
  return direction.acceptance;
}

describe('normalizeDirection — acceptance is always a string[]', () => {
  it('coerces a non-array acceptance to an empty list', () => {
    expect(acceptanceOf({ acceptance: 'one condition' })).toEqual([]);
    expect(acceptanceOf({ acceptance: null })).toEqual([]);
    expect(acceptanceOf({ acceptance: { 0: 'a' } })).toEqual([]);
  });

  it('keeps string entries verbatim', () => {
    expect(acceptanceOf({ acceptance: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('unwraps the object form `{ text }` — the documented forward-compat shape', () => {
    expect(acceptanceOf({ acceptance: [{ text: 'a' }, { text: 'b' }] })).toEqual(['a', 'b']);
  });

  it('accepts a mixed list of strings and `{ text }` objects', () => {
    expect(acceptanceOf({ acceptance: ['plain', { text: 'wrapped' }] })).toEqual([
      'plain',
      'wrapped',
    ]);
  });

  it('stringifies a non-string `text` instead of dropping the condition', () => {
    expect(acceptanceOf({ acceptance: [{ text: 12 }, { text: false }] })).toEqual(['12', 'false']);
  });

  it('drops entries with no usable text — null, undefined text, and bare objects', () => {
    expect(
      acceptanceOf({
        acceptance: [null, undefined, { text: null }, { text: undefined }, {}, 5, ['nested']],
      }),
    ).toEqual([]);
  });

  it('keeps the surviving entries when only some are unusable', () => {
    expect(acceptanceOf({ acceptance: ['keep', null, { text: 'keep too' }, {}] })).toEqual([
      'keep',
      'keep too',
    ]);
  });
});
