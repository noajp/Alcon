'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { SettingsSection, SettingsRow } from './SettingsSection';

const OPTIONS: { value: 'light' | 'dark' | 'system'; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

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
              const Icon = opt.icon;
              const active = mounted && theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setTheme(opt.value)}
                  className={`flex flex-col items-center gap-2 py-4 rounded-md border transition-colors ${
                    active
                      ? 'border-foreground bg-accent text-foreground'
                      : 'border-border text-muted-foreground hover:border-border hover:text-foreground'
                  }`}
                >
                  <Icon size={18} />
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
