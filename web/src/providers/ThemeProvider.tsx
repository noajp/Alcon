'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ThemeProviderProps as NextThemesProviderProps } from 'next-themes';

type ThemeProviderProps = React.ComponentProps<typeof NextThemesProvider>;

// Selectable themes. Each maps to a single html class (next-themes uses
// classList add/remove, which rejects space-separated values). Dark variants
// are listed in globals.css's "dark context" selectors (shared base tokens +
// Tailwind `dark:`); light variants (snow / ivory / mist) are NOT — they only
// re-tone the light surface ramp over :root. Keep this in sync with
// globals.css and the picker in AppearanceSettings.
const THEMES = ['light', 'snow', 'ivory', 'mist', 'dark', 'midnight', 'carbon', 'graphite'];
const THEME_CLASS: Record<string, string> = {
  light: 'light',
  snow: 'theme-snow',
  ivory: 'theme-ivory',
  mist: 'theme-mist',
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
