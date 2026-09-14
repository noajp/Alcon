import { describe, expect, it } from 'vitest';
import { interpolate, resolveLocale } from '../src/Function/i18n/locales';
import { MESSAGES } from '../src/Function/i18n/messages';

describe('i18n locale resolution', () => {
  it('normalizes supported regional language tags', () => {
    expect(resolveLocale('ja-JP')).toBe('ja');
    expect(resolveLocale('ko_KR')).toBe('ko');
    expect(resolveLocale('pt-BR')).toBe('en');
  });

  it('prefers a saved locale, then a supported browser locale', () => {
    expect(resolveLocale('fr', ['ja-JP'])).toBe('fr');
    expect(resolveLocale(null, ['de-DE', 'es-MX'])).toBe('es');
    expect(resolveLocale(null, ['de-DE'])).toBe('en');
  });

  it('interpolates named values without removing unknown placeholders', () => {
    expect(interpolate('Hello {name} {missing}', { name: 'Alcon' })).toBe('Hello Alcon {missing}');
  });

  it('keeps every non-English dictionary structurally complete', () => {
    const locales = Object.keys(MESSAGES) as Array<keyof typeof MESSAGES>;
    const expected = Object.keys(MESSAGES.ja).sort();
    for (const locale of locales) {
      expect(Object.keys(MESSAGES[locale]).sort()).toEqual(expected);
    }
  });

  it('includes translations for dynamic navigation and preference labels', () => {
    const required = [
      'New Element', 'New Object', 'New Initiative', 'Go to Now', 'Open Inbox',
      'Domain Elements', 'Open Notebook', 'Open Table', 'Open Team', 'Open Workload',
      'Open Calendar', 'Full name', 'Short name', 'Username', 'Monday', 'Sunday',
      'Saturday', 'System', 'Light', 'Dark', 'Smaller', 'Small', 'Default', 'Large',
      'Larger', 'Remove {label} from the rail',
    ];
    for (const dictionary of Object.values(MESSAGES)) {
      for (const message of required) expect(dictionary[message], message).toBeTruthy();
    }
  });
});
