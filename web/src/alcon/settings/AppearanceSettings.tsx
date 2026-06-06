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

const OPTIONS: ThemeOption[] = [
  { value: 'system',   label: 'System',   split: ['#ECECEE', '#1a1a1a'] },
  { value: 'light',    label: 'Light',    swatch: { bg: '#ECECEE', island: '#ffffff' } },
  { value: 'dark',     label: 'Dark',     swatch: { bg: '#1a1a1a', island: '#222222' } },
  { value: 'midnight', label: 'Midnight', swatch: { bg: '#181a20', island: '#20232c' } },
  { value: 'carbon',   label: 'Carbon',   swatch: { bg: '#0d0d0d', island: '#1c1c1c' } },
  { value: 'graphite', label: 'Graphite', swatch: { bg: '#1a1917', island: '#232120' } },
];

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

  useEffect(() => setMounted(true), []);

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
    </div>
  );
}
