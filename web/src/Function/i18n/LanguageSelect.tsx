'use client';

import { Check, ChevronDown, Languages } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from './locales';
import { useI18n } from './I18nProvider';

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('Language')}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-muted/40 px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/70"
        >
          <Languages size={14} />
          {!compact && <span>{LOCALE_NAMES[locale]}</span>}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {SUPPORTED_LOCALES.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => setLocale(option)} className="gap-2 text-[12px]">
            <span className="flex-1" lang={option}>{LOCALE_NAMES[option]}</span>
            {locale === option && <Check size={12} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
