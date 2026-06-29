'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { SettingsSection, SettingsRow } from './SettingsSection';

type ThemeOption = {
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
// Six steps. Sets `--fs` on <html>; globals.css multiplies every font-size by
// it, so text grows/shrinks while layout (px/rem spacing) stays put — unlike a
// `zoom`, which scales the whole UI. Keep the map in sync with the boot script
// in app/layout.tsx (applies the saved level before first paint).
export const FONT_SIZE_KEY = 'alcon.fontsize';
export const FONT_SIZES: { key: string; label: string; scale: number }[] = [
  { key: 'xs',      label: 'Small',          scale: 0.85 },
  { key: 's',       label: 'Slightly small', scale: 0.925 },
  { key: 'default', label: 'Default',        scale: 1 },
  { key: 'm',       label: 'Slightly large', scale: 1.075 },
  { key: 'l',       label: 'Large',          scale: 1.15 },
  { key: 'xl',      label: 'Extra large',    scale: 1.25 },
];

export function applyFontSize(scale: number) {
  const el = document.documentElement;
  if (scale === 1) el.style.removeProperty('--fs');
  else el.style.setProperty('--fs', String(scale));
}

function Swatch({ opt }: { opt: ThemeOption }) {
  if (opt.split) {
    return (
      <span className="relative block h-10 w-full rounded-md border border-border/50 overflow-hidden">
        <span className="absolute inset-y-0 left-0 w-1/2" style={{ backgroundColor: opt.split[0] }} />
        <span className="absolute inset-y-0 right-0 w-1/2" style={{ backgroundColor: opt.split[1] }} />
      </span>
    );
  }
  return (
    <span
      className="relative block h-10 w-full rounded-md border border-border/50 overflow-hidden"
      style={{ backgroundColor: opt.swatch!.bg }}
    >
      {/* a floating "island" inset, to preview the surface-on-backdrop tone */}
      <span
        className="absolute inset-x-2 bottom-1.5 top-2.5 rounded-[4px]"
        style={{ backgroundColor: opt.swatch!.island }}
      />
    </span>
  );
}

export function AppearanceSettings() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [fontSize, setFontSize] = useState('default');

  useEffect(() => {
    setMounted(true);
    try {
      const saved = window.localStorage.getItem(FONT_SIZE_KEY);
      if (saved && FONT_SIZES.some((f) => f.key === saved)) setFontSize(saved);
    } catch { /* ignore */ }
  }, []);

  const pickFontSize = (key: string) => {
    setFontSize(key);
    const opt = FONT_SIZES.find((f) => f.key === key);
    if (!opt) return;
    applyFontSize(opt.scale);
    try { window.localStorage.setItem(FONT_SIZE_KEY, key); } catch { /* ignore */ }
  };

  return (
    <div>
      <SettingsSection title="Appearance" description="Choose how Alcon looks on this device.">
        <div className="px-4 py-4">
          <div className="grid grid-cols-3 gap-2">
            {OPTIONS.map((opt) => {
              const active = mounted && theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex flex-col items-center gap-2 p-2 rounded-lg border transition-colors ${
                    active
                      ? 'border-foreground bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Swatch opt={opt} />
                  <span className="text-[12px] font-medium">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <SettingsRow label="Resolved theme" hint="What's actually showing right now.">
          <span className="text-[12px] text-muted-foreground capitalize">
            {mounted ? resolvedTheme ?? '—' : '—'}
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Font size" description="Adjust the size of text across the app.">
        <div className="px-4 py-4">
          <div className="grid grid-cols-3 gap-2">
            {FONT_SIZES.map((opt) => {
              const active = mounted && fontSize === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => pickFontSize(opt.key)}
                  className={`flex flex-col items-center gap-1 px-2 pt-2.5 pb-2 rounded-lg border transition-colors ${
                    active
                      ? 'border-foreground bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {/* "Aa" previews the relative size of this step. */}
                  <span className="leading-none font-semibold" style={{ fontSize: `${Math.round(15 * opt.scale)}px` }}>
                    Aa
                  </span>
                  <span className="text-[11px] font-medium">{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}
