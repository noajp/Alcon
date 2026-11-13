'use client';

import { ChevronDown, Languages } from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, MenuCheck } from '@/ui/dropdown-menu';
import { Button } from '@/ui/button';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from './locales';
import { useI18n } from './I18nProvider';

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="md"
          aria-label={t('Language')}
          className="gap-1.5 px-2.5"
        >
          <Languages size={14} />
          {!compact && <span>{LOCALE_NAMES[locale]}</span>}
          <ChevronDown size={12} className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[150px]">
        {SUPPORTED_LOCALES.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => setLocale(option)} className="gap-2 text-[12px]">
            <span className="flex-1" lang={option}>{LOCALE_NAMES[option]}</span>
            {locale === option && <MenuCheck />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
