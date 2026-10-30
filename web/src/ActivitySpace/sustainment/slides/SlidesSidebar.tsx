'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookMarked, ChevronRight, Copy, FilePlus, FileText, Folder as FolderIcon, FolderInput, Palette, Pencil, Trash2 } from 'lucide-react';
import { useI18n } from '@/Function/i18n/I18nProvider';
import { appDialog } from '@/Function/shared/appDialogStore';
import { SidebarRow, SidebarSectionLabel } from '@/Function/shared/SidebarRow';
import { useActiveSpaceId } from '@/Function/space/activeSpaceStore';
import { RenameInput } from '@/ActivitySpace/sustainment/notebook/RenameInput';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent,
  ContextMenuSubTrigger, ContextMenuTrigger,
} from '@/ui/context-menu';
import { useKata } from './kata/store/useKata';
import { SkillsDialog } from './kata/components/shell/SkillsDialog';
import { fromKataJson } from './kata/model/kataFile';
import { tx } from './kata/i18n';
import { slidesReady, useSlidesSync } from './sync';

/** Opens a .kata.json file as a new deck, in the open deck's folder or the first one. */
async function openDeckFile(file: File) {
  const st = useKata.getState();
  let read: ReturnType<typeof fromKataJson> = null;
  try { read = fromKataJson(await file.text()); } catch { read = null; }
  if (!read) { st.notify(tx('資料ファイルとして読めませんでした', "That isn't a deck file Slides can read")); return; }
  const active = st.files.find((x) => x.id === st.activeFileId);
  const folderId = active?.folderId ?? st.folders[0]?.id ?? st.createFolder();
  st.createFile(folderId, read.name, read.deck, read.mix);
}

// The sidebar's "+" makes decks and folders; a new one opens for naming in the list.
const RENAME_EVENT = 'alcon:slides-rename';
const askRename = (id: string) => window.dispatchEvent(new CustomEvent<string>(RENAME_EVENT, { detail: id }));

/** A new deck where the person is: the open deck's folder, else the first, else a new one. */
export function createDeckHere() {
  if (!slidesReady()) return null;
  const st = useKata.getState();
  const active = st.files.find((x) => x.id === st.activeFileId);
  const id = st.createFile(active?.folderId ?? st.folders[0]?.id ?? st.createFolder(tx('マイ資料', 'My decks')));
  askRename(id);
  return id;
}

export function createFolderHere() {
  if (!slidesReady()) return null;
  const id = useKata.getState().createFolder();
  askRename(id);
  return id;
}

/** Asks for a .kata.json file and opens it as a new deck. */
export function pickDeckFile() {
  if (!slidesReady()) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.hidden = true;
  // In the page while the picker is open: some browsers do not report a pick on a detached input.
  document.body.appendChild(input);
  input.onchange = () => { const f = input.files?.[0]; input.remove(); if (f) void openDeckFile(f); };
  input.oncancel = () => input.remove();
  input.click();
}

/**
 * Slides mode's sidebar: the Space's deck folders and decks, the way Notebook
 * lists its books. Picking a deck opens it in the editor; each row carries
 * its actions on a right-click. New decks come from the "+" at the top of
 * the sidebar. Below the list, this person's writing skills and the looks.
 */
export function SlidesSidebar({ onOpen }: { onOpen: () => void }) {
  const { t } = useI18n();
  const { ready } = useSlidesSync(useActiveSpaceId());
  const folders = useKata((s) => s.folders);
  const files = useKata((s) => s.files);
  const activeFileId = useKata((s) => s.activeFileId);
  const skillCount = useKata((s) => s.skills.filter((k) => k.enabled).length);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  // Radix hands focus back to the trigger as the menu closes; renaming after
  // that lets the field keep it.
  const startRename = (id: string) => { window.setTimeout(() => setRenaming(id), 0); };
  const st = () => useKata.getState();
  useEffect(() => {
    const onRename = (e: Event) => startRename((e as CustomEvent<string>).detail);
    window.addEventListener(RENAME_EVENT, onRename);
    return () => window.removeEventListener(RENAME_EVENT, onRename);
  }, []);

  const openDeck = (id: string) => { st().selectFile(id); onOpen(); };
  const deleteFolder = async (id: string, name: string, count: number) => {
    const message = count === 0 ? t('Delete the folder "{name}"? This cannot be undone.', { name })
      : count === 1 ? t('Delete the folder "{name}" and its 1 deck? This cannot be undone.', { name })
      : t('Delete the folder "{name}" and its {count} decks? This cannot be undone.', { name, count });
    if (await appDialog.confirm(message)) st().deleteFolder(id);
  };
  const deleteDeck = async (id: string, name: string) => {
    if (await appDialog.confirm(t('Delete the deck "{name}"? This cannot be undone.', { name }))) st().deleteFile(id);
  };
  const nameOrInput = (id: string, name: string, commit: (v: string) => void, onClick: () => void, className: string) => renaming === id ? (
    <RenameInput
      initial={name}
      onCommit={(v) => { if (v && v !== name) commit(v); setRenaming(null); }}
      onCancel={() => setRenaming(null)}
      className={`min-w-0 flex-1 bg-transparent ${className} text-foreground`}
    />
  ) : (
    <button type="button" onClick={onClick} onDoubleClick={() => startRename(id)} title={name} className="h-full min-w-0 flex-1 truncate text-left outline-none">
      {name}
    </button>
  );

  return (
    <div className="mt-1">
      <SidebarSectionLabel>{t('Slides')}</SidebarSectionLabel>
      <div className="mt-1 flex flex-col">
        {ready && folders.map((folder) => {
          const inside = files.filter((f) => f.folderId === folder.id);
          return (
            <div key={folder.id} className="mt-2.5 first:mt-0">
              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <SidebarRow
                    icon={<ChevronRight size={13} className={`transition-transform ${folder.open ? 'rotate-90' : ''}`} />}
                    meta={inside.length || undefined}>
                    {nameOrInput(folder.id, folder.name, (v) => st().renameFolder(folder.id, v), () => st().toggleFolder(folder.id), 'text-[12px] font-semibold')}
                  </SidebarRow>
                </ContextMenuTrigger>
                <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                  <ContextMenuItem onSelect={() => { const id = st().createFile(folder.id); onOpen(); startRename(id); }}><FilePlus /> {t('New deck')}</ContextMenuItem>
                  <ContextMenuItem onSelect={() => startRename(folder.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem variant="destructive" onSelect={() => void deleteFolder(folder.id, folder.name, inside.length)}><Trash2 /> {t('Delete folder')}</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
              {folder.open && inside.map((file) => (
                <ContextMenu key={file.id}>
                  <ContextMenuTrigger asChild>
                    <SidebarRow active={file.id === activeFileId} icon={<FileText size={14} />} meta={file.deck.slides.length} className="pl-3">
                      {nameOrInput(file.id, file.name, (v) => st().renameFile(file.id, v), () => openDeck(file.id), 'text-[12px] font-semibold')}
                    </SidebarRow>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="min-w-[180px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                    <ContextMenuItem onSelect={() => startRename(file.id)}><Pencil /> {t('Rename')}</ContextMenuItem>
                    <ContextMenuItem onSelect={() => st().duplicateFile(file.id)}><Copy /> {t('Duplicate')}</ContextMenuItem>
                    {folders.length > 1 && (
                      <ContextMenuSub>
                        <ContextMenuSubTrigger><FolderInput /> {t('Move to')}</ContextMenuSubTrigger>
                        <ContextMenuSubContent className="min-w-[160px]">
                          {folders.filter((f) => f.id !== folder.id).map((f) => (
                            <ContextMenuItem key={f.id} onSelect={() => st().moveFile(file.id, f.id)}><FolderIcon /> {f.name}</ContextMenuItem>
                          ))}
                        </ContextMenuSubContent>
                      </ContextMenuSub>
                    )}
                    <ContextMenuSeparator />
                    <ContextMenuItem variant="destructive" onSelect={() => void deleteDeck(file.id, file.name)}><Trash2 /> {t('Delete deck')}</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col">
        <SidebarRow icon={<BookMarked size={15} />} label={t('My skills')} meta={skillCount} onClick={() => setSkillsOpen(true)} />
        <SidebarRow icon={<Palette size={15} />} label={t('Look library')} onClick={() => { st().setPanel('design'); onOpen(); }} />
      </div>
      {/* The dialog is the editor's own, drawn with its tokens. */}
      {skillsOpen && createPortal(<div className="kata-root"><SkillsDialog onClose={() => setSkillsOpen(false)} /></div>, document.body)}
    </div>
  );
}
