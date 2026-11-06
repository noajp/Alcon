'use client';

import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { TRASH_DAYS, ownerOf, useAttachmentActions, type SpaceFile } from '@/hooks/attachmentData';

/** Moving a file to the trash, asked first; resolves whether it went. */
export function useTrashFile(file: SpaceFile | null) {
  const { t } = useI18n();
  const { remove } = useAttachmentActions(file ? ownerOf(file) : { kind: 'folder', id: '' });
  return async () => {
    if (!file) return false;
    if (!await appDialog.confirm(t('Move “{name}” to the trash? It can be restored for {days} days.', { name: file.name, days: TRASH_DAYS }))) return false;
    try { await remove.mutateAsync(file); return true; } catch { return false; }
  };
}
