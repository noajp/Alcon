'use client';

import { useMemo, useState } from 'react';
import { FilePlus, FileText, FolderPlus, Pencil, Pin, Plus, Search, Trash2 } from '@/ui/icons';
import { NavNoteIcon } from '@/Frame/sidebar/NavIcons';
import { useNotes } from '@/hooks/useNotesDb';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { RenameInput } from '@/Function/shared/RenameInput';
import { sectionsInFolder, filesInFolder, resolveSectionSelection } from '@/ActivitySpace/artifacts/notebook/noteTree';
import type { NoteNode } from '@/types/notes';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui/context-menu';
import type { NavigationState } from '@/types/navigation';
import { SidebarRow } from '@/Function/shared/SidebarRow';
import { Panel, PanelBody, PanelGroup, PanelHeader, PanelSearch, usePinned } from '@/Function/shared/PanelLayout';

// The Note list, in the AI list's shape: its title, then New / Search /
// Folder; then the pinned pages, the Books (root Folders) with their
// Sections beneath — picking one decides what the main pane's page list
// shows, and the highlighted row is the Section the pane actually shows —
// then every page by its last change, newest first. Books and Sections
// carry their actions on a right-click (New section / New page / Rename /
// Delete); a page's right-click pins it.
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
  const pins = usePinned('note');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const toggleGroup = (id: string) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
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

  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  /** A page's Book: walk up to the root Folder. */
  const bookOf = (node: NoteNode) => {
    let at: NoteNode | undefined = node;
    while (at?.parentId && byId.has(at.parentId)) at = byId.get(at.parentId);
    return at && at.id !== node.id ? at : null;
  };
  const openPage = (page: NoteNode) => {
    const book = bookOf(page);
    onViewChange('note');
    onNavigate({ noteFolderId: book?.id ?? null, noteSectionId: page.parentId && page.parentId !== book?.id ? page.parentId : null, noteId: page.id });
  };
  // "New": a page in the Section shown, else the first Book's first
  // Section; with no Book yet, one is made to hold it.
  const newPage = async () => {
    try {
      let folderId = activeFolderId ?? folders[0]?.id ?? null;
      if (!folderId) folderId = (await createNode('folder', t('Notebook'), null)).id;
      let sectionId = (activeFolderId === folderId ? shownSectionId : null) ?? sectionsInFolder(nodes, folderId)[0]?.id ?? null;
      if (!sectionId) sectionId = (await createNode('section', t('New section'), folderId)).id;
      const page = await createNode('file', t('Untitled'), sectionId);
      onViewChange('note');
      onNavigate({ noteFolderId: folderId, noteSectionId: sectionId, noteId: page.id });
    } catch (e) { console.error('Failed to create note page', e); }
  };
  const addBook = async () => {
    try {
      const book = await createNode('folder', t('New folder'), null);
      startRename(book.id);
    } catch (e) { console.error('Failed to create notebook', e); }
  };

  const q = query.trim().toLowerCase();
  const pages = nodes.filter((n) => n.type === 'file' && (!q || n.name.toLowerCase().includes(q)));
  const pinnedPages = pins.pinned.map((id) => pages.find((p) => p.id === id)).filter((p): p is NoteNode => !!p);
  const recentPages = pages.filter((p) => !pins.isPinned(p.id))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  const pageRow = (page: NoteNode) => (
    <ContextMenu key={page.id}>
      <ContextMenuTrigger asChild>
        <SidebarRow active={page.id === activeFileId} icon={<FileText size={14} />}>
          <button type="button" onClick={() => openPage(page)} title={page.name} className="h-full min-w-0 flex-1 truncate text-left outline-none">
            {page.name || t('Untitled')}
          </button>
        </SidebarRow>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={() => pins.toggle(page.id)}><Pin /> {t(pins.isPinned(page.id) ? 'Unpin' : 'Pin')}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

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
    <Panel label={t('Note')}>
      <PanelHeader title={t('Note')} />
      <PanelBody>
      <div className="flex flex-col">
        <SidebarRow icon={<Plus size={15} />} label={t('New')} onClick={() => void newPage()} />
        <SidebarRow icon={<Search size={15} />} label={t('Search')} active={searching} onClick={() => { setSearching((v) => !v); setQuery(''); }} />
        <SidebarRow icon={<FolderPlus size={15} />} label={t('Folder')} onClick={() => void addBook()} />
      </div>
      {searching && <div className="mt-1.5"><PanelSearch value={query} onChange={setQuery} placeholder={t('Search notes')} /></div>}

      <PanelGroup title={t('Pinned')} open={!closed.has('pinned')} onToggle={() => toggleGroup('pinned')} menu={[
        { label: t('New section'), onSelect: () => void addBook() },
        { label: t('Collapse others'), onSelect: () => setClosed(new Set(['books', 'recent'])) },
      ]}>
        {pinnedPages.length === 0
          ? <p className="px-2.5 py-1 text-[12px] text-muted-foreground">{t('Right-click a page to pin it.')}</p>
          : pinnedPages.map(pageRow)}
      </PanelGroup>

      <PanelGroup title={t('Folders')} open={!closed.has('books')} onToggle={() => toggleGroup('books')}>
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
      </PanelGroup>

      <PanelGroup title={t('Recent')} open={q ? true : !closed.has('recent')} onToggle={() => toggleGroup('recent')}>
        {recentPages.map(pageRow)}
      </PanelGroup>
      </PanelBody>
    </Panel>
  );
}
