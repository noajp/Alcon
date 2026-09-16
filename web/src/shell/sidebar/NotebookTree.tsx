'use client';

import { useMemo, useState } from 'react';
import { ChevronRight, FilePlus, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { NavNoteIcon } from '@/shell/sidebar/NavIcons';
import { useNotes } from '@/hooks/useNotesDb';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { RenameInput } from '@/ActivitySpace/sustainment/notebook/RenameInput';
import { sectionsInFolder, filesInFolder } from '@/ActivitySpace/sustainment/notebook/noteTree';
import type { NoteNode } from '@/types/notes';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui/context-menu';
import type { NavigationState } from '@/types/navigation';

// Notebook mode's sidebar — the Books (root Folders) with their Sections as
// a tree, the way Obsidian lists vaults and folders. Picking a Book or a
// Section decides what the main pane's page list shows; the pages themselves
// live there, not here. Books and Sections carry their actions on a
// right-click (New section / New page / Rename / Delete); new Books come
// from the "+" at the top of the sidebar.
export function NotebookTree({
  activeFolderId,
  activeSectionId,
  onNavigate,
  onViewChange,
}: {
  activeFolderId: string | null;
  activeSectionId: string | null;
  onNavigate: (nav: Partial<NavigationState>) => void;
  onViewChange: (view: string) => void;
}) {
  const { t } = useI18n();
  const { nodes, createNode, renameNode, deleteNode } = useNotes();
  const folders = useMemo(
    () => nodes.filter((n) => n.type === 'folder').sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );
  // Books start open; a chevron folds one away.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
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
      section = await createNode('section', 'New Section', folderId);
      // Seed a page so the new Section opens straight into the editor.
      const page = await createNode('file', 'Untitled', section.id);
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
      const page = await createNode('file', 'Untitled', sectionId);
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
    const what = [sections.length > 0 ? `${sections.length} section${sections.length === 1 ? '' : 's'}` : '', pages > 0 ? `${pages} page${pages === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
    if (!await appDialog.confirm(`Delete the notebook "${folder.name}"${what ? ` and its ${what}` : ''}? This cannot be undone.`)) return;
    try {
      await deleteNode(folder.id);
      if (activeFolderId === folder.id) onNavigate({ noteFolderId: null, noteSectionId: null, noteId: null });
    } catch (e) { console.error('Failed to delete notebook', e); }
  };
  const deleteSection = async (folderId: string, section: NoteNode) => {
    const pages = filesInFolder(nodes, section.id).length;
    const what = pages > 0 ? ` and its ${pages} page${pages === 1 ? '' : 's'}` : '';
    if (!await appDialog.confirm(`Delete the section "${section.name}"${what}? This cannot be undone.`)) return;
    try {
      await deleteNode(section.id);
      if (activeSectionId === section.id) onNavigate({ noteFolderId: folderId, noteSectionId: null, noteId: null });
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
    <button type="button" onClick={onOpen} title={node.name} className="min-w-0 flex-1 truncate text-left">
      {node.name}
    </button>
  );

  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 px-2 h-6 mt-3">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground/60">{t('Notebook')}</span>
      </div>
      <div className="mt-1 flex flex-col">
        {folders.map((folder) => {
          const sections = sectionsInFolder(nodes, folder.id);
          const open = !collapsed.has(folder.id);
          const bookActive = folder.id === activeFolderId && !activeSectionId;
          return (
            <div key={folder.id}>
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <div
                    className={`group flex h-8 w-full items-center gap-1 rounded-md pl-1 pr-2 text-[12px] font-semibold transition-colors duration-100 ${
                      bookActive ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(folder.id)) next.delete(folder.id); else next.add(folder.id); return next; })}
                      aria-label={open ? t('Collapse') : t('Expand')}
                      aria-expanded={open}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-transform hover:text-foreground ${open ? 'rotate-90' : ''} ${sections.length === 0 ? 'invisible' : ''}`}
                    >
                      <ChevronRight size={13} />
                    </button>
                    <NavNoteIcon size={16} />
                    {nameOrInput(folder, () => openBook(folder.id), 'text-[12px] font-semibold')}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <ContextMenuItem onSelect={() => void addSection(folder.id)}><FolderPlus /> {t('New section')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => startRename(folder.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => void deleteBook(folder)}><Trash2 /> {t('Delete notebook')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {open && sections.map((section) => {
                const active = section.id === activeSectionId;
                return (
                  <ContextMenu key={section.id}>
                    <ContextMenuTrigger asChild>
                      <div
                        className={`group flex h-7 w-full items-center gap-2 rounded-md pl-7 pr-2 text-[12px] font-semibold transition-colors duration-100 ${
                          active ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                        }`}
                      >
                        <span className={`h-3.5 w-[3px] shrink-0 rounded-full ${active ? 'bg-[var(--accent-default)]' : 'bg-[var(--text-tertiary)]'}`} />
                        {nameOrInput(section, () => openSection(folder.id, section.id), 'text-[12px] font-semibold')}
                      </div>
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
        {folders.length === 0 && (
          <div className="px-2.5 py-6 text-[11px] text-muted-foreground/60 leading-relaxed">
            {t('No notebooks yet — click + to add one.')}
          </div>
        )}
      </div>
    </div>
  );
}
