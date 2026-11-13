'use client';
import { Check, ChevronDown } from '@/ui/icons';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MENU_SEPARATOR, MenuSectionLabel, MenuShell } from '@/Function/shared/menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { ATHENA_EFFORTS, ATHENA_MODELS, setAthenaSettings, useAthenaSettings } from './athenaSettings';

/** Under a request box: who answers (Athena) and how — its model and effort. */
export function AthenaControls({ disabled }: { disabled?: boolean }) {
  const { t } = useI18n();
  const settings = useAthenaSettings();
  const model = ATHENA_MODELS.find((m) => m.id === settings.model) ?? ATHENA_MODELS[0];
  const effort = ATHENA_EFFORTS.find((e) => e.id === settings.effort) ?? ATHENA_EFFORTS[1];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled} aria-label={t('Athena settings')}
          className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50">
          <span className="font-medium text-foreground">Athena</span>
          <span>{model.label}</span>
          <span className="opacity-60">·</span>
          <span>{t(effort.label)}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        <MenuSectionLabel>{t('Model')}</MenuSectionLabel>
        {ATHENA_MODELS.map((m) => (
          <DropdownMenuItem key={m.id} onSelect={() => setAthenaSettings({ model: m.id })}>
            <span className="flex-1">{m.label}</span>{m.id === settings.model && <Check size={13} />}
          </DropdownMenuItem>
        ))}
        <div className={MENU_SEPARATOR} />
        <MenuSectionLabel>{t('Effort')}</MenuSectionLabel>
        {ATHENA_EFFORTS.map((e) => (
          <DropdownMenuItem key={e.id} onSelect={() => setAthenaSettings({ effort: e.id })}>
            <span className="flex-1">{t(e.label)}</span>{e.id === settings.effort && <Check size={13} />}
          </DropdownMenuItem>
        ))}
      </MenuShell>
    </DropdownMenu>
  );
}
