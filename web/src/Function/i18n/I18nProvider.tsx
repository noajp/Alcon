'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { MESSAGES } from './messages';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  interpolate,
  resolveLocale,
  type Locale,
} from './locales';

const LOCALE_CHANGE_EVENT = 'alcon:locale-change';

let cachedLocale: Locale | null = null;

function readLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  if (cachedLocale) return cachedLocale;
  let saved: string | null = null;
  try { saved = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* storage may be disabled */ }
  cachedLocale = resolveLocale(saved, window.navigator.languages ?? [window.navigator.language]);
  return cachedLocale;
}

function subscribe(listener: () => void): () => void {
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== LOCALE_STORAGE_KEY) return;
    cachedLocale = null;
    listener();
  };
  const handleChange = () => listener();
  window.addEventListener('storage', handleStorage);
  window.addEventListener(LOCALE_CHANGE_EVENT, handleChange);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(LOCALE_CHANGE_EVENT, handleChange);
  };
}

type Translate = (message: string, values?: Record<string, string | number>) => string;

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const defaultValue: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: (message, values) => interpolate(message, values),
};

// The English fallback also keeps independently rendered components (tests,
// previews, and future embedded surfaces) usable without app-level wiring.
const I18nContext = createContext<I18nContextValue>(defaultValue);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => DEFAULT_LOCALE);

  const setLocale = useCallback((nextLocale: Locale) => {
    cachedLocale = nextLocale;
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale); } catch { /* ignore */ }
    document.documentElement.lang = nextLocale;
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<Translate>((message, values) => {
    const translated = locale === 'en' ? message : (MESSAGES[locale][message] ?? message);
    return interpolate(translated, values);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
