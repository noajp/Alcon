'use client';

import { useLayoutEffect } from 'react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { useKata } from './kata/store/useKata';

/** The Slides editor speaks the app's language: call this wherever a deck is
 *  shown (the editor, a Deck widget) so a language change in Settings reaches
 *  it before the next paint. */
export function useKataLocale() {
  const { locale } = useI18n();
  useLayoutEffect(() => {
    if (useKata.getState().locale !== locale) useKata.getState().setLocale(locale);
  }, [locale]);
}
