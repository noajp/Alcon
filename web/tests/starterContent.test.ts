import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '@/Function/i18n/locales';
import { starterContent } from '@/Function/space/starterContent';

describe('starterContent', () => {
  it.each(SUPPORTED_LOCALES)('%s: every Initiative names Objects that exist', (locale) => {
    const content = starterContent(locale);
    const keys = content.objects.map((object) => object.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const group of content.initiatives) {
      for (const initiative of group.children) {
        expect(initiative.objectKeys.length).toBeGreaterThan(0);
        for (const key of initiative.objectKeys) expect(keys).toContain(key);
      }
    }
  });

  it.each(SUPPORTED_LOCALES)('%s: has the same shape as English', (locale) => {
    const content = starterContent(locale);
    const english = starterContent('en');
    expect(content.objects.map((o) => [o.key, o.elements.length])).toEqual(english.objects.map((o) => [o.key, o.elements.length]));
    expect(content.initiatives.map((g) => g.children.map((i) => i.objectKeys))).toEqual(english.initiatives.map((g) => g.children.map((i) => i.objectKeys)));
  });
});
