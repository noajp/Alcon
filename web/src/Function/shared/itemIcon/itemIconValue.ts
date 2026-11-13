import { LABEL_PALETTE } from '@/Function/shared/labelColor';

// =============================================================
// The icon and colour a Strategy, Object or Element can carry of its own.
//
//   icon   'glyph:<Name>'   one of Clayware's own drawings (@/ui/icons/glyphs)
//          'lucide:<name>'  one of the standard set, by its kebab-case name
//          anything else    an emoji, shown as text
//          null             the concept's default icon
//   color  a LABEL_PALETTE key, a '#rrggbb' hex, or null (the default tone)
//
// Pure: the picker writes these strings, every surface reads them back here.
// =============================================================

export type ItemIconValue =
  | { kind: 'glyph'; name: string }
  | { kind: 'lucide'; name: string }
  | { kind: 'emoji'; text: string };

const MAX_EMOJI_LENGTH = 16; // a flag or a skin-toned family is several code points

/** Reads a stored icon string. Unknown or empty values read as no icon. */
export function parseItemIcon(raw: string | null | undefined): ItemIconValue | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith('glyph:')) {
    const name = value.slice(6);
    return /^[A-Z][A-Za-z0-9]*$/.test(name) ? { kind: 'glyph', name } : null;
  }
  if (value.startsWith('lucide:')) {
    const name = value.slice(7);
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) ? { kind: 'lucide', name } : null;
  }
  if (value.length > MAX_EMOJI_LENGTH || /[A-Za-z0-9<>]/.test(value)) return null;
  return { kind: 'emoji', text: value };
}

export function glyphIcon(name: string): string { return `glyph:${name}`; }
export function lucideIcon(name: string): string { return `lucide:${name}`; }

/** The line weight of the standard set: a little heavier than its default,
 *  so it sits beside Clayware's solid drawings without looking faint. */
export const STANDARD_ICON_STROKE = 2.5;

/** The colours offered as swatches, in the order the picker shows them. */
export const ITEM_COLORS = LABEL_PALETTE;

const PALETTE_HEX: Record<string, string> = Object.fromEntries(LABEL_PALETTE.map((p) => [p.key, p.hex]));

/** The CSS colour for a stored colour, or null for the default tone. */
export function itemColor(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (PALETTE_HEX[value]) return PALETTE_HEX[value];
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : null;
}

/** Whether a stored colour is one of the swatches (else it is a custom hex). */
export function isPaletteColor(raw: string | null | undefined): boolean {
  return !!raw && raw in PALETTE_HEX;
}

const RECENT_KEY = 'clayware:recent-emoji';
const RECENT_MAX = 24;

/** The emoji picked most recently first, without repeats, at most 24. */
export function pushRecent(recent: readonly string[], emoji: string): string[] {
  return [emoji, ...recent.filter((e) => e !== emoji)].slice(0, RECENT_MAX);
}

export function readRecentEmoji(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(readRecentEmoji(), emoji))); } catch { /* storage may be off */ }
}

/** Whether a name (or its tags) matches a search, ignoring case and spaces. */
export function matchesSearch(query: string, ...texts: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  return texts.some((t) => !!t && t.toLowerCase().replace(/[\s-]+/g, '').includes(q));
}
