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
import { formatRelative } from '@/Function/shared/dateUtils';
import { useNotes } from '@/hooks/useNotesDb';
import type { NoteNode } from '@/types/notes';
import { filesInFolder, sectionsInFolder } from './noteTree';

// Note opens on its notebooks, as a list: each with how many sections and
// pages it holds and when it last changed. A notebook opens into its
// sections (the panel on the left) and their pages. Under the notebooks,
// the pages changed most recently, so the last thing written is one click
// away without knowing which notebook it is in.

const RECENT = 8;

export function NotebookList({ onOpenBook, onOpenPage }: {
  onOpenBook: (folderId: string) => void;
  onOpenPage: (page: NoteNode) => void;
}) {
  const { t } = useI18n();
  const { nodes, createNode, renameNode, deleteNode } = useNotes();
  const [renaming, setRenaming] = useState<string | null>(null);

  const books = useMemo(() => nodes.filter((n) => n.type === 'folder').map((book) => {
    const sections = sectionsInFolder(nodes, book.id);
    const pages = [...filesInFolder(nodes, book.id), ...sections.flatMap((s) => filesInFolder(nodes, s.id))];
    const changed = [book.updatedAt, ...pages.map((p) => p.updatedAt)].filter((x): x is string => !!x).sort().at(-1) ?? null;
    return { book, sections: sections.length, pages: pages.length, changed };
  }).sort((a, b) => a.book.name.localeCompare(b.book.name)), [nodes]);
  const recent = useMemo(() => nodes.filter((n) => n.type === 'file')
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')).slice(0, RECENT), [nodes]);

  const addBook = async () => {
    try {
      const book = await createNode('folder', t('New notebook'), null);
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
                        <span className="flex shrink-0 text-muted-foreground"><NavNoteIcon size={16} /></span>
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

        {recent.length > 0 && (
          <section className="mt-8 px-[30px] pb-8">
            <h2 className="mb-1.5 text-[12px] text-muted-foreground">{t('Recent')}</h2>
            <ul className="flex flex-col">
              {recent.map((page) => (
                <li key={page.id}>
                  <button type="button" onClick={() => onOpenPage(page)}
                    className="-mx-2 flex w-[calc(100%+16px)] min-w-0 items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13.5px] text-foreground transition-colors hover:bg-foreground/[0.04]">
                    <span className="min-w-0 flex-1 truncate">{page.name || t('Untitled')}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{when(page.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
