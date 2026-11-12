'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, FilePlus, Pencil, Plus, Trash2 } from '@/ui/icons';
import { Button } from '@/ui/button';
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
import { Panel, PanelBody } from '@/Function/shared/PanelLayout';

// The open notebook's panel: its name (with the way back to the list of
// notebooks), then its Sections — picking one decides which pages the main
// pane lists, and the highlighted row is the Section the pane actually
// shows. "New section" adds one with a first page, ready to write. A
// Section's right-click carries New page / Rename / Delete. With no
// notebook open there is no panel: the main pane is the list of them.
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
  const [renaming, setRenaming] = useState<string | null>(null);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  // The notebook shown: the one picked, else the open page's (walk up to the
  // root Folder) — a page opened from elsewhere arrives with only its id.
  const openFile = activeFileId ? byId.get(activeFileId) : undefined;
  const bookId = useMemo(() => {
    if (activeFolderId) return activeFolderId;
    let at: NoteNode | undefined = openFile;
    while (at?.parentId && byId.has(at.parentId)) at = byId.get(at.parentId);
    return at && at.type === 'folder' ? at.id : null;
  }, [activeFolderId, openFile, byId]);
  const book = bookId ? byId.get(bookId) : undefined;
  if (!book) return null;

  const sections = sectionsInFolder(nodes, book.id);
  const shownSectionId = resolveSectionSelection(nodes, book.id,
    (openFile && openFile.parentId !== book.id ? openFile.parentId : null) ?? activeSectionId, activeFileId);
  // Radix hands focus back to the trigger as the menu closes; renaming after
  // that, with the menu's own auto-focus off, lets the field keep it.
  const startRename = (id: string) => { window.setTimeout(() => setRenaming(id), 0); };
  const go = (nav: Partial<NavigationState>) => { onViewChange('note'); onNavigate(nav); };

  const addSection = async () => {
    let section: { id: string } | undefined;
    try {
      section = await createNode('section', t('New section'), book.id);
      // Seed a page so the new Section opens straight into the editor.
      const page = await createNode('file', t('Untitled'), section.id);
      go({ noteFolderId: book.id, noteSectionId: section.id, noteId: page.id });
      startRename(section.id);
    } catch (e) {
      console.error('Failed to create note section', e);
      // Don't leave a page-less Section behind if the page insert failed.
      if (section) { try { await deleteNode(section.id); } catch { /* best-effort */ } }
    }
  };
  const addPage = async (sectionId: string) => {
    try {
      const page = await createNode('file', t('Untitled'), sectionId);
      go({ noteFolderId: book.id, noteSectionId: sectionId, noteId: page.id });
    } catch (e) { console.error('Failed to create note file', e); }
  };
  const deleteSection = async (section: NoteNode) => {
    const pages = filesInFolder(nodes, section.id).length;
    const message = pages > 0
      ? t('Delete the section “{name}” and its {n} pages? This cannot be undone.', { name: section.name, n: pages })
      : t('Delete the section “{name}”? This cannot be undone.', { name: section.name });
    if (!await appDialog.confirm(message)) return;
    try {
      await deleteNode(section.id);
      // The pick and the open page both go if they were inside it.
      if (activeSectionId === section.id || openFile?.parentId === section.id) onNavigate({ noteFolderId: book.id, noteSectionId: null, noteId: null });
    } catch (e) { console.error('Failed to delete note section', e); }
  };

  return (
    <Panel label={book.name}>
      <header className="flex h-[50px] shrink-0 items-center gap-1 border-b border-border/60 bg-card px-2">
        <Button variant="ghost" size="icon-xs" aria-label={t('Notebooks')} title={t('Notebooks')}
          onClick={() => go({ noteFolderId: null, noteSectionId: null, noteId: null })}>
          <ChevronLeft size={15} />
        </Button>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground" title={book.name}>{book.name}</h2>
      </header>
      <PanelBody>
        <div className="flex flex-col">
          {sections.map((section) => {
            const active = section.id === shownSectionId;
            return (
              <ContextMenu key={section.id}>
                <ContextMenuTrigger asChild>
                  <SidebarRow active={active}
                    icon={<span className={`h-3.5 w-[3px] rounded-full ${active ? 'bg-[var(--accent-default)]' : 'bg-[var(--text-tertiary)]'}`} />}>
                    {renaming === section.id ? (
                      <RenameInput initial={section.name}
                        onCommit={(v) => { if (v && v !== section.name) void renameNode(section.id, v).catch((e) => console.error('Failed to rename note', e)); setRenaming(null); }}
                        onCancel={() => setRenaming(null)}
                        className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground" />
                    ) : (
                      <button type="button" title={section.name} className="h-full min-w-0 flex-1 truncate text-left outline-none"
                        onClick={() => go({ noteFolderId: book.id, noteSectionId: section.id, noteId: null })}>
                        {section.name}
                      </button>
                    )}
                  </SidebarRow>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <ContextMenuItem onSelect={() => void addPage(section.id)}><FilePlus /> {t('New page')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => startRename(section.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => void deleteSection(section)}><Trash2 /> {t('Delete section')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          <SidebarRow icon={<Plus size={15} />} label={t('New section')} onClick={() => void addSection()} />
        </div>
      </PanelBody>
    </Panel>
  );
}
