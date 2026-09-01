// Pure logic behind Settings > Preferences > General: how a comment author's
// display name is formatted, which text emoticons get converted, and which
// weekday a "first day of the week" label maps to. Each is a boundary case
// that's easy to get subtly wrong (empty name, no email, case-sensitivity).

import { describe, expect, it } from 'vitest';

import {
  formatDisplayName,
  convertEmoticons,
  firstDayOfWeekToIndex,
} from '@/alcon/settings/preferencesStore';

describe('formatDisplayName', () => {
  it('uses the full name as-is in Full name mode', () => {
    expect(formatDisplayName('Ada Lovelace', 'ada@example.com', 'Full name')).toBe('Ada Lovelace');
  });

  it('takes the first token in Short name mode', () => {
    expect(formatDisplayName('Ada Lovelace', 'ada@example.com', 'Short name')).toBe('Ada');
  });

  it('prefers the email local-part in Username mode', () => {
    expect(formatDisplayName('Ada Lovelace', 'ada@example.com', 'Username')).toBe('ada');
  });

  it('falls back to the email local-part when the name is missing', () => {
    expect(formatDisplayName(null, 'ada@example.com', 'Full name')).toBe('ada');
    expect(formatDisplayName('  ', 'ada@example.com', 'Short name')).toBe('ada');
  });

  it('falls back to "You" when neither name nor email is available', () => {
    expect(formatDisplayName(null, null, 'Full name')).toBe('You');
    expect(formatDisplayName(undefined, undefined, 'Username')).toBe('You');
  });
});

describe('convertEmoticons', () => {
  it('converts a smiley at the start and mid-sentence', () => {
    expect(convertEmoticons(':) hello')).toBe('🙂 hello');
    expect(convertEmoticons('hello :) there')).toBe('hello 🙂 there');
  });

  it('leaves emoticons embedded in a word alone', () => {
    // Not preceded by whitespace/start-of-string, so this isn't ":)" as a token.
    expect(convertEmoticons('a:)b')).toBe('a:)b');
  });

  it('converts the frown, grin, wink, tongue, and heart forms', () => {
    expect(convertEmoticons(':(')).toBe('🙁');
    expect(convertEmoticons(':D')).toBe('😀');
    expect(convertEmoticons(';)')).toBe('😉');
    expect(convertEmoticons(':P')).toBe('😛');
    expect(convertEmoticons('<3')).toBe('❤️');
  });

  it('leaves text with no emoticons untouched', () => {
    expect(convertEmoticons('no emoticons here')).toBe('no emoticons here');
  });
});

describe('firstDayOfWeekToIndex', () => {
  it('maps each label to the matching Date#getDay() index', () => {
    expect(firstDayOfWeekToIndex('Sunday')).toBe(0);
    expect(firstDayOfWeekToIndex('Monday')).toBe(1);
    expect(firstDayOfWeekToIndex('Saturday')).toBe(6);
  });
});
