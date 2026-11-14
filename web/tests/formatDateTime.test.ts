/** @vitest-environment jsdom */
//
// formatDateTime shows a moment in the app's language — the one the person
// chose in Settings, read from storage — never the browser's own.

import { afterEach, describe, expect, it } from 'vitest';
import { formatDateTime } from '@/Function/shared/dateUtils';
import { LOCALE_STORAGE_KEY } from '@/Function/i18n/locales';

const moment = new Date(2026, 10, 14, 18, 6);

afterEach(() => { window.localStorage.removeItem(LOCALE_STORAGE_KEY); });

describe('formatDateTime', () => {
  it('follows the language chosen in the app', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'ja');
    expect(formatDateTime(moment)).toContain('2026年11月14日');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(formatDateTime(moment)).toContain('Nov 14, 2026');
  });

  it('takes another shape when asked', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(formatDateTime(moment, { month: 'short' })).toBe('Nov');
  });

  it('is empty for a missing or invalid moment', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('')).toBe('');
    expect(formatDateTime('not a date')).toBe('');
  });
});
