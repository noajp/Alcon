'use client';

import { useMemo, useState } from 'react';
import { FilePlus, Pencil, Plus, Trash2 } from '@/ui/icons';
import { useNotes } from '@/hooks/useNotesDb';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { RenameInput } from '@/Function/shared/RenameInput';
import { sectionsInFolder, filesInFolder, resolveSectionSelection } from './noteTree';
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
import { PanelBody } from '@/Function/shared/PanelLayout';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/popover';
import { Button } from '@/ui/button';
import { LABEL_PALETTE, paletteHex } from '@/Function/shared/labelColor';
import { FIELD } from '@/shared/designTokens';

// An open notebook's Sections, as the column left of its pages: picking
// one decides which pages the list beside it shows, and the highlighted row
// is the Section actually shown. "New section" adds one with a first page,
// ready to write. A Section's right-click carries New page / Rename /
// Delete. The notebook itself is named in the header above.
export function SectionsPane({
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
  const { nodes, createNode, renameNode, deleteNode, moveNodes } = useNotes();
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

  const addSection = async (name: string, color: string | null) => {
    let section: { id: string } | undefined;
    try {
      // The notebook's loose pages (written before it had Sections) move into
      // its first Section: with Sections, only a Section's pages are listed.
      const loose = sections.length === 0 ? filesInFolder(nodes, book.id) : [];
      section = await createNode('section', name, book.id, { color });
      if (loose.length > 0) {
        await moveNodes(loose.map((p) => p.id), section.id);
        go({ noteFolderId: book.id, noteSectionId: section.id, noteId: loose[0].id });
        return;
      }
      // Seed a page so the new Section opens straight into the editor.
      const page = await createNode('file', t('Untitled'), section.id);
      go({ noteFolderId: book.id, noteSectionId: section.id, noteId: page.id });
    } catch (e) {
      console.error('Failed to create note section', e);
      // Don't leave a page-less Section behind if the page insert failed.
      if (section && filesInFolder(nodes, section.id).length === 0) { try { await deleteNode(section.id); } catch { /* best-effort */ } }
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
    <aside aria-label={t('Sections')} className="flex w-56 shrink-0 flex-col overflow-hidden border-r border-border/40 bg-[var(--surface-well)]">
      <PanelBody>
        <div className="flex flex-col">
          {sections.map((section) => {
            const active = section.id === shownSectionId;
            return (
              <ContextMenu key={section.id}>
                <ContextMenuTrigger asChild>
                  <SidebarRow active={active}>
                    {/* The Section's color band, hard against the row's left
                        edge, with the name close beside it. */}
                    <span className={`-ml-1.5 -mr-1 h-4 w-[3px] shrink-0 rounded-full ${section.color ? '' : active ? 'bg-[var(--accent-default)]' : 'bg-[var(--text-tertiary)]'}`}
                      style={section.color ? { backgroundColor: paletteHex(section.color) } : undefined} />
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
          <NewSection onCreate={addSection} />
        </div>
      </PanelBody>
    </aside>
  );
}

/** "New section": asks for the Section's name — it cannot be made without
 *  one — and its color, then makes it. */
function NewSection({ onCreate }: { onCreate: (name: string, color: string | null) => Promise<void> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = name.trim().length > 0 && !busy;
  const create = async () => {
    if (!ready) return;
    setBusy(true);
    try { await onCreate(name.trim(), color); setOpen(false); setName(''); setColor(null); }
    finally { setBusy(false); }
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setName(''); setColor(null); } }}>
      <PopoverTrigger asChild>
        <SidebarRow icon={<Plus size={15} />} label={t('New section')} active={open} onClick={() => setOpen(true)} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] space-y-3 p-3">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
          placeholder={t('Section name')} aria-label={t('Section name')} aria-required="true"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void create(); } }}
          className={`${FIELD.base} h-8 w-full bg-transparent px-2.5 text-[13px] text-foreground`} />
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t('Color')}>
          {LABEL_PALETTE.map((p) => (
            <button key={p.key} type="button" role="radio" aria-checked={color === p.key} aria-label={t(p.label)} title={t(p.label)}
              onClick={() => setColor(color === p.key ? null : p.key)}
              className={`flex size-6 items-center justify-center rounded-full transition-shadow ${color === p.key ? 'ring-2 ring-[var(--accent-default)] ring-offset-2 ring-offset-popover' : ''}`}>
              <span className="size-4 rounded-full" style={{ backgroundColor: p.hex }} />
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" disabled={!ready} onClick={() => void create()}>{t('Create')}</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
