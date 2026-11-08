import { describe, expect, it } from 'vitest';
import {
  APPROVAL_MODE_DESCRIPTIONS, APPROVAL_MODE_LABELS, APPROVAL_MODE_ORDER, approvalModeOf,
} from '@/AIP/connectors/approvalModeModel';
import { APP_TRANSLATIONS } from '@/Function/i18n/appMessages';

// The settings screen's vocabulary for the approval modes: three modes,
// in the order the screen offers them, each with a label and a promise —
// and every word of it translated in all four locales, since the select
// and its explanation are how an owner learns what they are choosing.

describe('approval mode model', () => {
  it('offers ask, auto, free — in that order', () => {
    expect(APPROVAL_MODE_ORDER).toEqual(['ask', 'auto', 'free']);
    for (const mode of APPROVAL_MODE_ORDER) {
      expect(APPROVAL_MODE_LABELS[mode]).toBeTruthy();
      expect(APPROVAL_MODE_DESCRIPTIONS[mode]).toBeTruthy();
    }
  });

  it('reads a stored value as a mode, falling back to auto like the engine', () => {
    expect(approvalModeOf('ask')).toBe('ask');
    expect(approvalModeOf('auto')).toBe('auto');
    expect(approvalModeOf('free')).toBe('free');
    expect(approvalModeOf(null)).toBe('auto');
    expect(approvalModeOf('sometimes')).toBe('auto');
  });

  it('has all four translations for every string the section shows', () => {
    const shown = [
      'Approval mode', 'Approval mode history',
      'Only Space owners can change the approval mode.',
      "Couldn't load the approval mode: {error}", "Couldn't change the approval mode: {error}",
      'How the AI\u2019s writes in this Space are held, above each connection\u2019s own permissions. A run keeps the mode it started under; changing the mode never approves what already waits.',
      ...Object.values(APPROVAL_MODE_LABELS),
      ...Object.values(APPROVAL_MODE_DESCRIPTIONS),
    ];
    for (const locale of ['ja', 'ko', 'fr', 'es'] as const) {
      for (const s of shown) {
        expect(APP_TRANSLATIONS[locale][s], `${locale}: ${s}`).toBeTruthy();
      }
    }
  });
});
