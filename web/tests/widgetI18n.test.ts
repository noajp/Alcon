import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@/Function/i18n/messages';
import { WIDGET_REGISTRY } from '@/Function/widget/registry';

// A widget's name is its title on every board and its row in the picker, so
// a widget added without translations shows English to every other locale.
describe('widget i18n', () => {
  it('translates every widget name and description in every locale', () => {
    const keys = Object.values(WIDGET_REGISTRY).flatMap(def => [def.label, ...(def.description ? [def.description] : [])]);
    for (const locale of ['ja', 'ko', 'fr', 'es'] as const) {
      const missing = keys.filter(key => !(key in MESSAGES[locale]));
      expect(missing, locale).toEqual([]);
    }
  });
});
