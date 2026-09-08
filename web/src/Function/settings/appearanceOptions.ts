// Appearance data: theme choices and the font-size (UI text scale) system.
// Consumed by SettingsView's Preferences panel. Keep in sync with the boot
// script in app/layout.tsx (applies the font-size level before first paint)
// and with the THEMES list in providers/ThemeProvider.tsx.

export type ThemeOption = {
  value: string;
  label: string;
  // Mini preview: an "island" floating on the backdrop. `split` (System) shows
  // a half-light / half-dark chip instead. Colours mirror globals.css.
  swatch?: { bg: string; island: string };
  split?: [string, string];
};

export const OPTIONS: ThemeOption[] = [
  { value: 'system',   label: 'System',   split: ['#ECECEE', '#1a1a1a'] },
  { value: 'light',    label: 'Light',    swatch: { bg: '#ECECEE', island: '#ffffff' } },
  { value: 'snow',     label: 'Snow',     swatch: { bg: '#ffffff', island: '#f3f3f4' } },
  { value: 'ivory',    label: 'Ivory',    swatch: { bg: '#f1eee6', island: '#fffdf6' } },
  { value: 'mist',     label: 'Mist',     swatch: { bg: '#e9edf3', island: '#fbfcfe' } },
  { value: 'dark',     label: 'Dark',     swatch: { bg: '#1a1a1a', island: '#222222' } },
  { value: 'midnight', label: 'Midnight', swatch: { bg: '#181a20', island: '#20232c' } },
  { value: 'carbon',   label: 'Carbon',   swatch: { bg: '#0d0d0d', island: '#1c1c1c' } },
  { value: 'graphite', label: 'Graphite', swatch: { bg: '#1a1917', island: '#232120' } },
];

// ---- Font size (text-only UI scale) --------------------------------------
// Five steps centered on a slightly-large baseline (`default` = 1.075), which
// is the out-of-the-box size. Sets `--fs` on <html>; globals.css multiplies
// every font-size by it, so text grows/shrinks while layout (px/rem spacing)
// stays put — unlike a `zoom`, which scales the whole UI. Keep the map in sync
// with the boot script in app/layout.tsx (applies the level before first paint).
export const FONT_SIZE_KEY = 'alcon.fontsize';
export const DEFAULT_FONT_KEY = 'default';
export const FONT_SIZES: { key: string; label: string; scale: number }[] = [
  { key: 'smaller', label: 'Smaller', scale: 0.925 },
  { key: 'small',   label: 'Small',   scale: 1 },
  { key: 'default', label: 'Default', scale: 1.075 },
  { key: 'large',   label: 'Large',   scale: 1.15 },
  { key: 'larger',  label: 'Larger',  scale: 1.25 },
];

export function applyFontSize(scale: number) {
  document.documentElement.style.setProperty('--fs', String(scale));
}
