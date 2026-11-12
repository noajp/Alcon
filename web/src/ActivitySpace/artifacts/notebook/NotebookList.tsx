'use client';

import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from '@/ui/icons';
import { Button } from '@/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/ui/context-menu';
import { NavNoteIcon } from '@/Frame/sidebar/NavIcons';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { IslandHeader } from '@/Function/shared/MainIsland';
import { RenameInput } from '@/Function/shared/RenameInput';
import { ItemIconButton } from '@/Function/shared/itemIcon/IconPicker';
import { formatRelative } from '@/Function/shared/dateUtils';
import { useNotes } from '@/hooks/useNotesDb';
import type { NoteNode } from '@/types/notes';
import { filesInFolder, sectionsInFolder } from './noteTree';

// Note opens on its notebooks, as a list: each with how many sections and
// pages it holds and when it last changed. A notebook opens into its
// sections (the panel on the left) and their pages.

export function NotebookList({ onOpenBook }: {
  onOpenBook: (folderId: string) => void;
}) {
  const { t } = useI18n();
  const { nodes, createNode, renameNode, deleteNode, setNodeIcon } = useNotes();
  const [renaming, setRenaming] = useState<string | null>(null);

  const books = useMemo(() => nodes.filter((n) => n.type === 'folder').map((book) => {
    const sections = sectionsInFolder(nodes, book.id);
    const pages = [...filesInFolder(nodes, book.id), ...sections.flatMap((s) => filesInFolder(nodes, s.id))];
    const changed = [book.updatedAt, ...pages.map((p) => p.updatedAt)].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return { book, sections: sections.length, pages: pages.length, changed };
  }).sort((a, b) => a.book.name.localeCompare(b.book.name)), [nodes]);

  const addBook = async () => {
    try {
      const book = await createNode('folder', t('New notebook'), null);
      // A notebook always has a Section: pages live in Sections, never loose.
      const section = await createNode('section', t('Section 1'), book.id);
      await createNode('file', t('Untitled'), section.id);
      setRenaming(book.id);
    } catch (e) { console.error('Failed to create notebook', e); }
  };
  const removeBook = async (book: NoteNode, sections: number, pages: number) => {
    const message = sections > 0 || pages > 0
      ? t('Delete the notebook “{name}” and its {sections} sections and {pages} pages? This cannot be undone.', { name: book.name, sections, pages })
      : t('Delete the notebook “{name}”? This cannot be undone.', { name: book.name });
    if (!await appDialog.confirm(message)) return;
    try { await deleteNode(book.id); } catch (e) { console.error('Failed to delete notebook', e); }
  };
  const when = (iso: string | null | undefined) => (iso ? formatRelative(iso) : '');

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-card">
      <IslandHeader crumbs={[{ id: 'note', label: t('Note') }]} actions={
        <Button variant="ghost" size="sm" onClick={() => void addBook()}><Plus size={14} />{t('New notebook')}</Button>
      } />
      <div className="flex-1 overflow-auto">
        <table className="w-full table-fixed border-separate border-spacing-0 text-[13px]">
          <colgroup><col /><col style={{ width: 120 }} /><col style={{ width: 120 }} /><col style={{ width: 160 }} /></colgroup>
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground">
              <th className="px-[30px] py-2.5 font-normal">{t('Name')}</th>
              <th className="px-3 py-2.5 font-normal">{t('Sections')}</th>
              <th className="px-3 py-2.5 font-normal">{t('Pages')}</th>
              <th className="px-3 py-2.5 font-normal">{t('Updated')}</th>
            </tr>
          </thead>
          <tbody>
            {books.map(({ book, sections, pages, changed }) => (
              <ContextMenu key={book.id}>
                <ContextMenuTrigger asChild>
                  <tr className="cursor-pointer transition-colors hover:bg-foreground/[0.04]" onClick={() => { if (renaming !== book.id) onOpenBook(book.id); }}>
                    <td className="px-[30px] py-2.5">
                      <span className="flex min-w-0 items-center gap-3">
                        {/* The notebook's own icon; a click on it changes it (and does not open the notebook). */}
                        <span className="flex shrink-0 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                          <ItemIconButton size={16} value={{ icon: book.icon ?? null, color: null }} defaultIcon={<NavNoteIcon size={16} />}
                            onChange={(next) => void setNodeIcon(book.id, next.icon).catch((e) => console.error('Failed to set notebook icon', e))} />
                        </span>
                        {renaming === book.id ? (
                          <RenameInput initial={book.name}
                            onCommit={(v) => { if (v && v !== book.name) void renameNode(book.id, v); setRenaming(null); }}
                            onCancel={() => setRenaming(null)}
                            className="min-w-0 flex-1 bg-transparent text-[15px] font-medium text-foreground" />
                        ) : <span className="min-w-0 truncate text-[15px] font-medium text-foreground">{book.name}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{sections}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{pages}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{when(changed)}</td>
                  </tr>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <ContextMenuItem onSelect={() => window.setTimeout(() => setRenaming(book.id), 0)}><Pencil /> {t('Rename')}</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => void removeBook(book, sections, pages)}><Trash2 /> {t('Delete notebook')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </tbody>
        </table>
        {books.length === 0 && <p className="px-[30px] py-3 text-[13px] text-muted-foreground">{t('No notebooks yet.')}</p>}
      </div>
    </div>
  );
}
