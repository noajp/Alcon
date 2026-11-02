'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  interpolate,
  resolveLocale,
  type Locale,
} from './locales';

const LOCALE_CHANGE_EVENT = 'alcon:locale-change';

type TranslationMap = Record<string, string>;
type Dictionaries = Record<Exclude<Locale, 'en'>, TranslationMap>;

// The dictionaries (ja / ko / fr / es, ~800KB of source) are fetched only when
// the viewer's language is not English, so English viewers never download
// them. Until they arrive, messages fall back to the English source text.
let dictionaries: Dictionaries | null = null;
let dictionariesRequest: Promise<void> | null = null;

function loadDictionaries(): Promise<void> {
  dictionariesRequest ??= import('./messages').then((m) => {
    dictionaries = m.MESSAGES;
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT));
  }).catch((error) => {
    dictionariesRequest = null;
    console.error('Failed to load translations', error);
  });
  return dictionariesRequest;
}

/** The app dictionary's entry for `message` in `locale`, if it has arrived. */
export function appMessage(locale: Locale, message: string): string | undefined {
  return locale === 'en' ? message : dictionaries?.[locale][message];
}

let cachedLocale: Locale | null = null;

function readLocale(): Locale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  if (cachedLocale) return cachedLocale;
  let saved: string | null = null;
  try { saved = window.localStorage.getItem(LOCALE_STORAGE_KEY); } catch { /* storage may be disabled */ }
  cachedLocale = resolveLocale(saved, window.navigator.languages ?? [window.navigator.language]);
  if (cachedLocale !== 'en') void loadDictionaries();
  return cachedLocale;
}

/** The viewer's language outside React (data-layer notices); `t` inside it. */
export function translate(message: string, values?: Record<string, string | number>): string {
  return interpolate(appMessage(readLocale(), message) ?? message, values);
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
  // Re-render once the dictionaries arrive so `t` picks them up.
  const loadedDictionaries = useSyncExternalStore(subscribe, () => dictionaries, () => null);

  const setLocale = useCallback((nextLocale: Locale) => {
    cachedLocale = nextLocale;
    if (nextLocale !== 'en') void loadDictionaries();
    try { window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale); } catch { /* ignore */ }
    document.documentElement.lang = nextLocale;
    window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT));
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useCallback<Translate>((message, values) => {
    const translated = locale === 'en' ? message : (loadedDictionaries?.[locale][message] ?? message);
    return interpolate(translated, values);
  }, [locale, loadedDictionaries]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
