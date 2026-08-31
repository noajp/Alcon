// Object ID prefix suggestion.
//
// The prefixes exist to be spoken: comments and SITREPs refer to work as
// el_MED-001. The DB trigger's fallback derives them from the first character
// of each whitespace token, which turns CJK names into unreadable IDs
// ("TF-MED — 医療・防疫" → "T—医") that also collide with their siblings
// ("T—航", "T—兵"). These tests pin the client-side replacement: ASCII out,
// unique among siblings, regardless of the language the name was written in.

import { describe, expect, it } from 'vitest';

import { suggestObjectPrefix } from '@/alcon/object/objectPrefix';

describe('suggestObjectPrefix', () => {
  it('uses token initials for multi-token names', () => {
    expect(suggestObjectPrefix('Ward East Wing')).toBe('WEW');
    expect(suggestObjectPrefix('Phase 2')).toBe('P2');
  });

  it('keeps only the ASCII tokens of a mixed CJK name', () => {
    // The motivating case: the exercise task force that became "T—医".
    expect(suggestObjectPrefix('TF-MED — 医療・防疫')).toBe('TM');
    expect(suggestObjectPrefix('UX Quality — Linear 基準')).toBe('UQL');
  });

  it('truncates single-token names to the length cap', () => {
    expect(suggestObjectPrefix('Marketing')).toBe('MARK');
    expect(suggestObjectPrefix('Strategy 深化')).toBe('STRA');
  });

  it('treats an accented word as one token, not several', () => {
    // NFKD splits "ü" into "u" + a combining mark. Left in, the mark reads as
    // a word boundary and "Zürich" comes back as the initials of two words.
    expect(suggestObjectPrefix('Zürich')).toBe('ZURI');
    expect(suggestObjectPrefix('Sénégal')).toBe('SENE');
    expect(suggestObjectPrefix('Ångström Lab')).toBe('AL');
    expect(suggestObjectPrefix('Café Nord')).toBe('CN');
  });

  it('folds full-width characters to ASCII', () => {
    // Same result as the half-width spelling: ＴＦ－ＭＥＤ → TF-MED → TM.
    expect(suggestObjectPrefix('ＴＦ－ＭＥＤ 医療')).toBe('TM');
  });

  it('falls back to OBJ when the name has no ASCII content', () => {
    expect(suggestObjectPrefix('医療部')).toBe('OBJ');
    expect(suggestObjectPrefix('・・・')).toBe('OBJ');
    expect(suggestObjectPrefix('')).toBe('OBJ');
  });

  it('caps the base at four characters by default', () => {
    expect(suggestObjectPrefix('a b c d e f')).toBe('ABCD');
  });

  it('honours a caller-supplied cap', () => {
    // Domain identifiers allow six, which is why the cap is a parameter.
    expect(suggestObjectPrefix('Marketing', [], 6)).toBe('MARKET');
    expect(suggestObjectPrefix('a b c d e f', [], 6)).toBe('ABCDEF');
  });

  it('uniquifies against existing prefixes, case-insensitively', () => {
    expect(suggestObjectPrefix('TF-AIR 航空', ['TM', 'TL'])).toBe('TA');
    expect(suggestObjectPrefix('TF-AIR 航空', ['ta', 'TL'])).toBe('TA2');
    expect(suggestObjectPrefix('医療部', ['OBJ', 'OBJ2'])).toBe('OBJ3');
  });

  it('ignores null-ish entries in the existing list', () => {
    expect(suggestObjectPrefix('Marketing', ['', 'MARK'])).toBe('MARK2');
  });
});
