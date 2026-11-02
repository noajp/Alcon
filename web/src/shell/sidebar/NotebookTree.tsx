'use client';

import { useMemo, useState } from 'react';
import { FilePlus, FolderPlus, Pencil, Trash2 } from '@/ui/icons';
import { NavNoteIcon } from '@/shell/sidebar/NavIcons';
import { useNotes } from '@/hooks/useNotesDb';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { RenameInput } from '@/ActivitySpace/sustainment/notebook/RenameInput';
import { sectionsInFolder, filesInFolder, resolveSectionSelection } from '@/ActivitySpace/sustainment/notebook/noteTree';
import type { NoteNode } from '@/types/notes';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui/context-menu';
import type { NavigationState } from '@/types/navigation';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';

// Notebook mode's sidebar — the Books (root Folders) with their Sections
// always listed beneath, the way Obsidian lists a vault. Picking a Book or
// a Section decides what the main pane's page list shows; the pages
// themselves live there, not here. The row that is highlighted is the
// Section the pane actually shows — resolved the same way the pane does —
// so the two never disagree. Books and Sections carry their actions on a
// right-click (New section / New page / Rename / Delete); new Books come
// from the "+" at the top of the sidebar.
export function NotebookTree({
  activeFolderId,
  activeSectionId,
  activeFileId,
  onNavigate,
  onViewChange,
}: {
  activeFolderId: string | null;
  activeSectionId: string | null;
  activeFileId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { t } = useI18n();
  const { nodes, createNode, renameNode, deleteNode } = useNotes();
  const folders = useMemo(
    () => nodes.filter((n) => n.type === 'folder').sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  // The Section the pane shows for the active Book: the open page's, else
  // the pick, else the first (see NotebookSurface).
  const openFile = activeFileId ? nodes.find((n) => n.id === activeFileId) : undefined;
  const shownSectionId = activeFolderId
    ? resolveSectionSelection(nodes, activeFolderId, (openFile && openFile.parentId !== activeFolderId ? openFile.parentId : null) ?? activeSectionId, activeFileId)
    : null;
  // Radix hands focus back to the trigger as the menu closes; renaming after
  // that, with the menu's own auto-focus off, lets the field keep it.
  const startRename = (id: string) => { window.setTimeout(() => setRenaming(id), 0); };

  const openBook = (folderId: string) => {
    onViewChange('note');
    onNavigate({ noteFolderId: folderId, noteSectionId: null, noteId: null });
  };
  const openSection = (folderId: string, sectionId: string) => {
    onViewChange('note');
    onNavigate({ noteFolderId: folderId, noteSectionId: sectionId, noteId: null });
  };
  const addSection = async (folderId: string) => {
    let section: { id: string } | undefined;
    try {
      section = await createNode('section', t('New section'), folderId);
      // Seed a page so the new Section opens straight into the editor.
      const page = await createNode('file', t('Untitled'), section.id);
      onViewChange('note');
      onNavigate({ noteFolderId: folderId, noteSectionId: section.id, noteId: page.id });
      startRename(section.id);
    } catch (e) {
      console.error('Failed to create note section', e);
      // Don't leave a page-less Section behind if the page insert failed.
      if (section) { try { await deleteNode(section.id); } catch { /* best-effort */ } }
    }
  };
  const addPage = async (folderId: string, sectionId: string) => {
    try {
      const page = await createNode('file', t('Untitled'), sectionId);
      onViewChange('note');
      onNavigate({ noteFolderId: folderId, noteSectionId: sectionId, noteId: page.id });
    } catch (e) { console.error('Failed to create note file', e); }
  };
  const rename = async (id: string, name: string) => {
    try { await renameNode(id, name); } catch (e) { console.error('Failed to rename note', e); }
  };
  const deleteBook = async (folder: NoteNode) => {
    const sections = sectionsInFolder(nodes, folder.id);
    const pages = sections.reduce((n, s) => n + filesInFolder(nodes, s.id).length, filesInFolder(nodes, folder.id).length);
    const message = sections.length > 0 || pages > 0
      ? t('Delete the notebook “{name}” and its {sections} sections and {pages} pages? This cannot be undone.', { name: folder.name, sections: sections.length, pages })
      : t('Delete the notebook “{name}”? This cannot be undone.', { name: folder.name });
    if (!await appDialog.confirm(message)) return;
    try {
      await deleteNode(folder.id);
      if (activeFolderId === folder.id) onNavigate({ noteFolderId: null, noteSectionId: null, noteId: null });
    } catch (e) { console.error('Failed to delete notebook', e); }
  };
  const deleteSection = async (folderId: string, section: NoteNode) => {
    const pages = filesInFolder(nodes, section.id).length;
    const message = pages > 0
      ? t('Delete the section “{name}” and its {n} pages? This cannot be undone.', { name: section.name, n: pages })
      : t('Delete the section “{name}”? This cannot be undone.', { name: section.name });
    if (!await appDialog.confirm(message)) return;
    try {
      await deleteNode(section.id);
      // The pick and the open page both go if they were inside it.
      if (activeSectionId === section.id || openFile?.parentId === section.id) onNavigate({ noteFolderId: folderId, noteSectionId: null, noteId: null });
    } catch (e) { console.error('Failed to delete note section', e); }
  };

  const nameOrInput = (node: NoteNode, onOpen: () => void, className: string) => renaming === node.id ? (
    <RenameInput
      initial={node.name}
      onCommit={(v) => { if (v && v !== node.name) void rename(node.id, v); setRenaming(null); }}
      onCancel={() => setRenaming(null)}
      className={`min-w-0 flex-1 bg-transparent ${className} text-foreground`}
    />
  ) : (
    <button type="button" onClick={onOpen} title={node.name} className="h-full min-w-0 flex-1 truncate text-left outline-none">
      {node.name}
    </button>
  );

  return (
    <div className="mt-1">
      <SidebarSectionLabel>{t('Notebook')}</SidebarSectionLabel>
      <div className="mt-1 flex flex-col">
        {folders.map((folder) => {
          const sections = sectionsInFolder(nodes, folder.id);
          // The Book itself is the row to highlight only while nothing below
          // it is shown (a Book without Sections).
          const bookActive = folder.id === activeFolderId && !shownSectionId;
          return (
            // Books sit apart from each other; the Sections under one sit
            // close, so the tree reads as groups, like the Domain tree.
            <div key={folder.id} className="mt-2.5 first:mt-0">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <SidebarRow active={bookActive} icon={<NavNoteIcon size={16} />}>
                    {nameOrInput(folder, () => openBook(folder.id), 'text-[12px] font-semibold')}
                  </SidebarRow>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <ContextMenuItem onSelect={() => void addSection(folder.id)}><FolderPlus /> {t('New section')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => startRename(folder.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => void deleteBook(folder)}><Trash2 /> {t('Delete notebook')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {sections.map((section) => {
                const active = folder.id === activeFolderId && section.id === shownSectionId;
                return (
                  <ContextMenu key={section.id}>
                    <ContextMenuTrigger asChild>
                      <SidebarRow size="sm" active={active}
                        icon={<span className={`h-3.5 w-[3px] rounded-full ${active ? 'bg-[var(--accent-default)]' : 'bg-[var(--text-tertiary)]'}`} />}>
                        {nameOrInput(section, () => openSection(folder.id, section.id), 'text-[12px] font-medium')}
                      </SidebarRow>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                      <ContextMenuItem onSelect={() => void addPage(folder.id, section.id)}><FilePlus /> {t('New page')}</ContextMenuItem>
                      <ContextMenuItem onSelect={() => startRename(section.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onSelect={() => void deleteSection(folder.id, section)}><Trash2 /> {t('Delete section')}</ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
