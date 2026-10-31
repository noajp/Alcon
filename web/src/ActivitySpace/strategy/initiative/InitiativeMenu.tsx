'use client';

import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { deleteStrategy } from '@/hooks/strategyData';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/ui/context-menu';

/**
 * An Initiative row's right-click menu, wherever the row is listed (the
 * Initiative list, a Portfolio): delete it. Deleting leaves the
 * linked Objects and their Elements alone; a refusal (only the creator may
 * delete) is said, not swallowed.
 */
export function InitiativeMenu({ initiative, children }: {
  initiative: { id: string; name: string };
  children: ReactNode;
}) {
  const { t } = useI18n();
  const remove = async () => {
    const ok = await appDialog.confirm(
      `${t('Delete "{name}"?', { name: initiative.name })} ${t("Its Intents, comments, and nesting links are deleted. Linked Objects stay. This can't be undone.")}`,
    );
    if (!ok) return;
    try { await deleteStrategy(initiative.id); }
    catch (e) { await appDialog.alert(e instanceof Error ? e.message : t('Could not delete the Initiative')); }
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onSelect={() => void remove()}><Trash2 size={14} />{t('Delete')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
