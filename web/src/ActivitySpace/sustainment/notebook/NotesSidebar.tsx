'use client';

import { appDialog } from '@/Function/shared/appDialogStore';

import { useMemo, useState } from 'react';
import {
  FolderClosed,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { NoteNode } from './types';
import { RenameInput } from './RenameInput';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui/context-menu';

// 2-tier Note sidebar: a flat list of root Folders (scoped to the Activity
// Space). Files live in the middle pane (FilesPane), not here — selecting a
// Folder drives that pane's file list.
//
// UI terminology = Folder / File (DB types match: 'folder' / 'file').

interface NotesSidebarProps {
  nodes: NoteNode[];
  selectedFolderId: string | null;
  /** Folder click handler — receives a folder id. */
  onSelectFolder: (id: string) => void;
  onDeleteNode?: (id: string) => void;
  /** Rename a Folder (from the right-click menu's inline edit). */
  onRenameNode?: (id: string, name: string) => void;
}

export function NotesSidebar({
  nodes,
  selectedFolderId,
  onSelectFolder,
  onDeleteNode,
  onRenameNode,
}: NotesSidebarProps) {
  const { t } = useI18n();
  // Folders are the root nodes (scoped to the Activity Space); their files live
  // in the middle pane (FilesPane), not here. Flat, alpha-sorted list. Folder +
  // file creation lives in the bottom "+ Create new" menu, so there's no header
  // affordance here.
  const folders = useMemo(
    () => nodes.filter((n) => n.type === 'folder').sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  return (
    <aside className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex-1 overflow-auto pb-3">
        {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              selected={selectedFolderId === f.id}
              onSelect={() => onSelectFolder(f.id)}
              onRenameNode={onRenameNode}
              onDelete={onDeleteNode ? async () => {
                if (await appDialog.confirm(t('Delete the folder "{name}" and its pages? This cannot be undone.', { name: f.name }))) {
                  onDeleteNode(f.id);
                }
              } : undefined}
            />
          ))}
      </div>
    </aside>
  );
}

// ============================================
// FolderRow — a root-level folder. Click selects it (drives the middle
// pane's file list).
// ============================================

function FolderRow({
  folder,
  selected,
  onSelect,
  onRenameNode,
  onDelete,
}: {
  folder: NoteNode;
  selected: boolean;
  onSelect: () => void;
  onRenameNode?: (id: string, name: string) => void;
  onDelete?: () => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            'group flex items-center h-8 pl-2 pr-2 rounded-md transition-colors duration-100',
            selected ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50',
          ].join(' ')}
        >
          <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-2">
            <FolderClosed size={15} />
          </span>
          {renaming ? (
            <RenameInput
              initial={folder.name}
              onCommit={(v) => { if (v && v !== folder.name) onRenameNode?.(folder.id, v); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
              className="flex-1 min-w-0 bg-transparent text-[12px] font-semibold text-muted-foreground"
            />
          ) : (
            <button
              type="button"
              onClick={onSelect}
              className="flex-1 min-w-0 flex items-center text-left h-full"
            >
              {/* Always gray — the selected folder is marked by its highlighted
                  row, not by brightening the text. */}
              <span className="text-[12px] font-semibold truncate text-muted-foreground">
                {folder.name}
              </span>
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[170px]">
        {onRenameNode && (
          <ContextMenuItem className="gap-2" onSelect={() => setRenaming(true)}>
            <Pencil size={13} /> {t('Rename')}
          </ContextMenuItem>
        )}
        {onDelete && (
          <>
            {onRenameNode && <ContextMenuSeparator />}
            <ContextMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={onDelete}>
              <Trash2 size={13} /> {t('Delete folder')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}


// ============================================
// ============================================

/** Empty state shown in the editor area when no file is selected (or no
 *  files exist at all). Kept here for back-compat with the MainContent
 *  import; the OneNote layout reduces how often it's actually visible. */
export function BriefsEmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex-1 flex items-center justify-center text-center px-8 py-12">
      <p className="text-[13px] text-muted-foreground">{t('Select a page to start writing.')}</p>
    </div>
  );
}
