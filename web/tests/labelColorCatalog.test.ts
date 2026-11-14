import { describe, expect, it } from 'vitest';
import { hydrateDomainLabelColors, labelColor, LABEL_PALETTE, setLabelColorLocal } from '@/Function/shared/labelColor';

const hex = (key: string) => LABEL_PALETTE.find((p) => p.key === key)!.hex;

describe('label colours from the Domain list', () => {
  it('gives each Domain its own picked colours, whichever Domain is active', () => {
    hydrateDomainLabelColors([
      { id: 'dom-ja', label_colors: { 採用: 'pink', 研修: 'green' } },
      { id: 'dom-en', label_colors: { Hiring: 'teal' } },
    ]);
    expect(labelColor('採用', 'dom-ja')).toBe(hex('pink'));
    expect(labelColor('研修', 'dom-ja')).toBe(hex('green'));
    expect(labelColor('Hiring', 'dom-en')).toBe(hex('teal'));
    // A name one Domain picked a colour for keeps the other Domain's own.
    expect(labelColor('採用', 'dom-en')).not.toBe(hex('pink'));
  });

  it('does not paint an older list over a Domain already seeded', () => {
    hydrateDomainLabelColors([{ id: 'dom-pick', label_colors: { Bug: 'red' } }]);
    setLabelColorLocal('dom-pick', 'Bug', 'teal');
    hydrateDomainLabelColors([{ id: 'dom-pick', label_colors: { Bug: 'red' } }]);
    expect(labelColor('Bug', 'dom-pick')).toBe(hex('teal'));
  });

  it('reads a Domain without picks as auto colours, not as an error', () => {
    hydrateDomainLabelColors([{ id: 'dom-empty', label_colors: null }]);
    expect(labelColor('Anything', 'dom-empty')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
