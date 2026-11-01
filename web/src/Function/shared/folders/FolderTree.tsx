'use client';

import { useState, type ReactNode } from 'react';
import { Folder as FolderIcon, FolderOpen, FolderPlus, MoreHorizontal } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { DisclosureTriangle } from '@/Function/shared/DisclosureTriangle';
import { SidebarRow, SidebarRowAction, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { MenuShell, MenuSectionLabel, MENU_SEPARATOR } from '@/Function/shared/menu';
import { useFolderActions, useFolders, type FolderApp } from '@/hooks/folderData';

/** Something a folder can hold: a file, a Table. */
export interface FolderItem { id: string; name: string; folderId: string | null; icon: ReactNode; meta?: ReactNode }

/**
 * An app's folders and what is in them, two levels as the sidebar shows
 * them: each folder folds open on its items; items in no folder follow.
 * A folder's "…" renames or deletes it, an item's moves it to another
 * folder; "New folder" adds one. `onOpenFolder` makes a folder's name open
 * the folder as a page as well (Files); without it the name only folds
 * (Table).
 */
export function FolderTree({ app, title, items, activeItemId, activeFolderId, onOpenItem, onOpenFolder, onMoveItem, onDeleteItem }: {
  app: FolderApp;
  title: string;
  items: FolderItem[];
  activeItemId?: string | null;
  activeFolderId?: string | null;
  onOpenItem: (id: string) => void;
  onOpenFolder?: (id: string) => void;
  onMoveItem: (id: string, folderId: string | null) => void | Promise<void>;
  /** Given, an item's menu can delete it (the caller asks first). */
  onDeleteItem?: (id: string) => void;
}) {
  const { t } = useI18n();
  const { data: folders } = useFolders(app);
  const { create, rename, remove } = useFolderActions(app);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const fail = (e: unknown) => void appDialog.alert(e instanceof Error ? e.message : String(e));
  const toggle = (id: string) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const newFolder = async () => {
    const name = (await appDialog.prompt(t('Folder name')))?.trim();
    if (name) create.mutate(name, { onError: fail });
  };
  const itemMenu = (item: FolderItem) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarRowAction label={t('More')} onClick={() => {}}><MoreHorizontal size={14} /></SidebarRowAction>
      </DropdownMenuTrigger>
      <MenuShell as="dropdown" align="start">
        <MenuSectionLabel>{t('Move to')}</MenuSectionLabel>
        {folders.filter((f) => f.id !== item.folderId).map((f) => (
          <DropdownMenuItem key={f.id} onSelect={() => { void Promise.resolve(onMoveItem(item.id, f.id)).catch(fail); }}>
            <FolderIcon size={13} />{f.name}
          </DropdownMenuItem>
        ))}
        {item.folderId && app === 'tables' && (
          <DropdownMenuItem onSelect={() => { void Promise.resolve(onMoveItem(item.id, null)).catch(fail); }}>{t('Out of the folder')}</DropdownMenuItem>
        )}
        {folders.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">{t('No folders yet.')}</div>}
        {onDeleteItem && <>
          <div className={MENU_SEPARATOR} />
          <DropdownMenuItem onSelect={() => onDeleteItem(item.id)}>{t('Delete')}</DropdownMenuItem>
        </>}
      </MenuShell>
    </DropdownMenu>
  );
  const itemRow = (item: FolderItem, nested: boolean) => (
    <SidebarRow key={item.id} size={nested ? 'sm' : 'md'} active={item.id === activeItemId} icon={item.icon} label={item.name} title={item.name}
      meta={item.meta} onClick={() => onOpenItem(item.id)} className={nested ? 'pl-5' : ''} actions={itemMenu(item)} />
  );

  return (
    <div className="mt-1">
      <SidebarSectionLabel>{title}</SidebarSectionLabel>
      <div className="mt-1 flex flex-col">
        {folders.map((f) => {
          const open = !closed.has(f.id);
          const children = items.filter((i) => i.folderId === f.id);
          return (
            <div key={f.id}>
              <SidebarRow active={f.id === activeFolderId} title={f.name} buttonProps={{ 'aria-expanded': open }}
                icon={open ? <FolderOpen size={15} /> : <FolderIcon size={15} />}
                label={<span className="flex items-center gap-1.5">{f.name}<DisclosureTriangle open={open} className="text-muted-foreground/70" /></span>}
                onClick={() => {
                  // In Files a folder is also a page: its name opens it (and
                  // keeps it unfolded); elsewhere the name only folds.
                  if (onOpenFolder) { onOpenFolder(f.id); if (!open) toggle(f.id); } else toggle(f.id);
                }}
                actions={(
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SidebarRowAction label={t('More')} onClick={() => {}}><MoreHorizontal size={14} /></SidebarRowAction>
                    </DropdownMenuTrigger>
                    <MenuShell as="dropdown" align="start">
                      <DropdownMenuItem onSelect={async () => {
                        const name = (await appDialog.prompt(t('Folder name'), f.name))?.trim();
                        if (name && name !== f.name) rename.mutate({ id: f.id, name }, { onError: fail });
                      }}>{t('Rename')}</DropdownMenuItem>
                      <div className={MENU_SEPARATOR} />
                      <DropdownMenuItem onSelect={async () => {
                        if (!await appDialog.confirm(t('Delete the folder “{name}”?', { name: f.name }))) return;
                        remove.mutate(f.id, { onError: fail });
                      }}>{t('Delete')}</DropdownMenuItem>
                    </MenuShell>
                  </DropdownMenu>
                )} />
              {open && children.map((i) => itemRow(i, true))}
            </div>
          );
        })}
        {items.filter((i) => !i.folderId || !folders.some((f) => f.id === i.folderId)).map((i) => itemRow(i, false))}
        <SidebarRow icon={<FolderPlus size={15} />} label={t('New folder')} onClick={() => void newFolder()} className="text-muted-foreground" />
      </div>
    </div>
  );
}
