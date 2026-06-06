'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ThemeProviderProps as NextThemesProviderProps } from 'next-themes';

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

// Selectable themes. Each maps to a single html class (next-themes uses
// classList add/remove, which rejects space-separated values). The dark
// variants are their own class; globals.css treats `.dark` and every
// `.theme-*` as a "dark context" (shared base tokens + Tailwind `dark:`),
// and each variant block only re-tones the surface ramp. Keep this in sync
// with globals.css and the picker in AppearanceSettings.
const THEMES = ['light', 'dark', 'midnight', 'carbon', 'graphite'];
const THEME_CLASS: Record<string, string> = {
  light: 'light',
  dark: 'dark',
  midnight: 'theme-midnight',
  carbon: 'theme-carbon',
  graphite: 'theme-graphite',
};

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      themes={THEMES}
      value={THEME_CLASS}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
