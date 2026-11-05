import { describe, expect, it } from 'vitest';
import { itemColor, isPaletteColor, matchesSearch, parseItemIcon, pushRecent } from '@/Function/shared/itemIcon/itemIconValue';

describe('parseItemIcon', () => {
  it('reads the three kinds', () => {
    expect(parseItemIcon('glyph:GuidingStar')).toEqual({ kind: 'glyph', name: 'GuidingStar' });
    expect(parseItemIcon('lucide:rocket')).toEqual({ kind: 'lucide', name: 'rocket' });
    expect(parseItemIcon('lucide:a-arrow-down')).toEqual({ kind: 'lucide', name: 'a-arrow-down' });
    expect(parseItemIcon('🚀')).toEqual({ kind: 'emoji', text: '🚀' });
    expect(parseItemIcon('👨‍👩‍👧‍👦')).toEqual({ kind: 'emoji', text: '👨‍👩‍👧‍👦' });
  });

  it('reads empty and malformed values as no icon', () => {
    expect(parseItemIcon(null)).toBeNull();
    expect(parseItemIcon('  ')).toBeNull();
    expect(parseItemIcon('glyph:guidingStar')).toBeNull();
    expect(parseItemIcon('glyph:<script>')).toBeNull();
    expect(parseItemIcon('lucide:Rocket')).toBeNull();
    expect(parseItemIcon('lucide:')).toBeNull();
    expect(parseItemIcon('rocket')).toBeNull();
    expect(parseItemIcon('x'.repeat(40))).toBeNull();
  });
});

describe('itemColor', () => {
  it('maps palette keys and passes hex through', () => {
    expect(itemColor('teal')).toBe('#14b8a6');
    expect(itemColor('#AABBCC')).toBe('#aabbcc');
    expect(isPaletteColor('teal')).toBe(true);
    expect(isPaletteColor('#aabbcc')).toBe(false);
  });

  it('reads unknown values as the default tone', () => {
    expect(itemColor(null)).toBeNull();
    expect(itemColor('')).toBeNull();
    expect(itemColor('blue')).toBeNull();
    expect(itemColor('#abc')).toBeNull();
    expect(itemColor('red;background:url(x)')).toBeNull();
  });
});

describe('recent emoji', () => {
  it('puts the newest first without repeats and keeps 24', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    const many = Array.from({ length: 30 }, (_, i) => String(i));
    expect(pushRecent(many, 'x')).toHaveLength(24);
  });
});

describe('matchesSearch', () => {
  it('ignores case, spaces and hyphens', () => {
    expect(matchesSearch('ArrowDown', 'a-arrow-down')).toBe(true);
    expect(matchesSearch('笑顔', 'サングラスで笑顔')).toBe(true);
    expect(matchesSearch('', 'anything')).toBe(true);
    expect(matchesSearch('zzz', 'rocket', undefined)).toBe(false);
  });
});
