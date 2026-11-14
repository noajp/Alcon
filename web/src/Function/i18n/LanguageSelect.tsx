'use client';

import { ChevronDown, Languages } from '@/ui/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, MenuCheck } from '@/ui/dropdown-menu';
import { Button } from '@/ui/button';
import { CONTROL_WELL, CONTROL_WELL_HOVER } from '@/shared/designTokens';
import { LOCALE_NAMES, SUPPORTED_LOCALES } from './locales';
import { useI18n } from './I18nProvider';

/** `field` gives the trigger the ground and the height of a settings
 *  control, for a row where it stands beside other selects; without it the
 *  trigger is bare. */
export function LanguageSelect({ compact = false, field = false }: { compact?: boolean; field?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={field ? 'sm' : 'md'}
          aria-label={t('Language')}
          className={`gap-1.5 px-2.5 ${field ? `${CONTROL_WELL} ${CONTROL_WELL_HOVER}` : ''}`}
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
