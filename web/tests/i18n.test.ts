import { describe, expect, it } from 'vitest';
import { interpolate, resolveLocale } from '../src/Function/i18n/locales';

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
});
