'use client';

import { KeyRound } from '@/ui/icons';
import { DropdownMenuItem } from '@/ui/dropdown-menu';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { WorkerAvatar, type WorkerAvatarSubject } from '@/Function/shared/WorkerAvatar';
import { openModelKeySettings } from '@/Function/settings/settingsNav';

/**
 * An AI Worker in a picker that cannot be chosen yet: its model has no API key
 * in this Space. The row says so, and choosing it opens the settings where the
 * key is set, instead of assigning work the Worker cannot do.
 */
export function ModelKeyRow({ worker, avatarSize = 16 }: { worker: WorkerAvatarSubject & { id: string }; avatarSize?: number }) {
  const { t } = useI18n();
  return (
    <DropdownMenuItem onSelect={() => openModelKeySettings()} className="gap-2 text-[12px] text-muted-foreground"
      title={t('{name} needs an API key before it can take work. Set it in Settings › Connectors.', { name: worker.name ?? '' })}>
      <span className="opacity-50"><WorkerAvatar worker={worker} size={avatarSize} /></span>
      <span className="flex-1 truncate">{worker.name}</span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px]">
        <KeyRound size={11} />{t('Set API key')}
      </span>
    </DropdownMenuItem>
  );
}
