'use client';

import { useMemo, useState } from 'react';
import {
  ChevronRight,
  FolderClosed,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { NoteNode, NoteNodeType } from './types';
import type { Domain } from '@/types/database';
import { CabinetIcon } from '@/shell/icons';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/ui/context-menu';

// OneNote-style 2-tier sidebar: Cabinet → Folder. Files live in the middle
// pane (FilesPane), not here. Each Cabinet expands to its Folders only —
// files always live inside a Folder (creation routes them there), so there's
// no loose-file surface to show.
//
// UI terminology = Cabinet / Folder / File. DB types stay 'notebook' /
// 'folder' / 'file' (see types/notes.ts).

interface NotesSidebarProps {
  nodes: NoteNode[];
  selectedFolderId: string | null;
  /** Folder click handler — receives a folder id. */
  onSelectFolder: (id: string) => void;
  /** Create a node.
   *  - type='notebook' → parentId is ignored, always at root.
   *  - type='folder'   → parentId must be a cabinet (notebook) id.
   *  - type='file'     → not used from this component (FilesPane owns file
   *    creation), kept on the type for API parity. */
  onCreateNode?: (type: NoteNodeType, parentId: string | null) => void;
  onDeleteNode?: (id: string) => void;
  /** Rename a Cabinet or Folder (from the right-click menu's inline edit). */
  onRenameNode?: (id: string, name: string) => void;
  /** Domain list for the Cabinet → Domain link picker. Hidden when omitted. */
  domains?: Domain[];
  /** Persist a Cabinet's linked Domain (or null to clear). */
  onSetLinkedDomain?: (cabinetId: string, domainId: string | null) => void;
}

export function NotesSidebar({
  nodes,
  selectedFolderId,
  onSelectFolder,
  onCreateNode,
  onDeleteNode,
  onRenameNode,
  domains,
  onSetLinkedDomain,
}: NotesSidebarProps) {
  // Pre-index nodes once per render so the inner rows can ask "what folders
  // are under this cabinet?" without re-walking the array each time.
  const { cabinets, foldersByCabinet } = useMemo(() => {
    const cabinets: NoteNode[] = [];
    const foldersByCabinet = new Map<string, NoteNode[]>();
    for (const n of nodes) {
      if (n.type === 'notebook') {
        cabinets.push(n);
      } else if (n.type === 'folder' && n.parentId) {
        const list = foldersByCabinet.get(n.parentId) ?? [];
        list.push(n);
        foldersByCabinet.set(n.parentId, list);
      }
    }
    cabinets.sort((a, b) => a.name.localeCompare(b.name));
    for (const list of foldersByCabinet.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { cabinets, foldersByCabinet };
  }, [nodes]);

  return (
    <aside className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* NoteSpace header — matches the "Action Space" / "Execution Space"
          section labels (mixed-case, not all-caps) so the camelCase shows. */}
      <div className="flex items-center h-10 px-3">
        <span className="text-[16px] font-bold text-muted-foreground select-none">
          NoteSpace
        </span>
        {/* No header "+" — new Cabinets are created from the bottom
            "+ Create new" menu (New Notebook). */}
      </div>

      <div className="flex-1 overflow-auto pb-3">
        {cabinets.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground/60 text-center">
            No cabinets yet — click + to create one
          </div>
        )}
        {cabinets.map((cab) => (
          <CabinetRow
            key={cab.id}
            cabinet={cab}
            folders={foldersByCabinet.get(cab.id) ?? []}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onCreateNode={onCreateNode}
            onDeleteNode={onDeleteNode}
            onRenameNode={onRenameNode}
            domains={domains}
            onSetLinkedDomain={onSetLinkedDomain}
          />
        ))}
      </div>
    </aside>
  );
}

// ============================================
// CabinetRow — expandable row with folder children. Right-click opens a
// context menu (Rename / New folder / Link domain / Delete); no inline
// hover buttons.
// ============================================

interface CabinetRowProps {
  cabinet: NoteNode;
  folders: NoteNode[];
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
  onCreateNode?: (type: NoteNodeType, parentId: string | null) => void;
  onDeleteNode?: (id: string) => void;
  onRenameNode?: (id: string, name: string) => void;
  domains?: Domain[];
  onSetLinkedDomain?: (cabinetId: string, domainId: string | null) => void;
}

function CabinetRow({
  cabinet,
  folders,
  selectedFolderId,
  onSelectFolder,
  onCreateNode,
  onDeleteNode,
  onRenameNode,
  domains,
  onSetLinkedDomain,
}: CabinetRowProps) {
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const linkedDomain = domains?.find((d) => d.id === cabinet.linkedDomainId) ?? null;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group flex items-center h-8 pl-2 pr-2 hover:bg-accent">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className={[
                'w-4 h-5 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform duration-100',
                expanded ? 'rotate-90' : '',
              ].join(' ')}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              <ChevronRight size={13} />
            </button>
            <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-2">
              <CabinetIcon size={15} />
            </span>
            {renaming ? (
              <RenameInput
                initial={cabinet.name}
                onCommit={(v) => { if (v && v !== cabinet.name) onRenameNode?.(cabinet.id, v); setRenaming(false); }}
                onCancel={() => setRenaming(false)}
                className="flex-1 min-w-0 bg-transparent text-[12px] font-semibold text-foreground"
              />
            ) : (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex-1 min-w-0 flex items-center text-left"
              >
                <span className="text-[12px] font-semibold truncate text-muted-foreground">
                  {cabinet.name}
                </span>
                {linkedDomain && (
                  <span
                    className="ml-2 inline-flex items-center px-1.5 h-4 rounded text-[10px] bg-muted text-muted-foreground"
                    title={`Linked to domain: ${linkedDomain.name}`}
                  >
                    <span className="truncate max-w-[60px]">{linkedDomain.name}</span>
                  </span>
                )}
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-[180px]">
          {onRenameNode && (
            <ContextMenuItem className="gap-2" onSelect={() => setRenaming(true)}>
              <Pencil size={13} /> Rename
            </ContextMenuItem>
          )}
          {onCreateNode && (
            <ContextMenuItem className="gap-2" onSelect={() => { setExpanded(true); onCreateNode('folder', cabinet.id); }}>
              <FolderPlus size={13} /> New folder
            </ContextMenuItem>
          )}
          {domains && domains.length > 0 && onSetLinkedDomain && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="gap-2">Link domain</ContextMenuSubTrigger>
              <ContextMenuSubContent className="min-w-[170px]">
                <ContextMenuItem onSelect={() => onSetLinkedDomain(cabinet.id, null)}>
                  <span className="text-muted-foreground">No link</span>
                </ContextMenuItem>
                {domains.map((d) => (
                  <ContextMenuItem key={d.id} onSelect={() => onSetLinkedDomain(cabinet.id, d.id)}>
                    <span className="flex-1 truncate">{d.name}</span>
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {onDeleteNode && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onSelect={() => {
                  if (confirm(`"${cabinet.name}" を削除しますか?\n中のフォルダ・ファイルも削除されます。`)) {
                    onDeleteNode(cabinet.id);
                  }
                }}
              >
                <Trash2 size={13} /> Delete cabinet
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {expanded && (
        <div>
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              selected={selectedFolderId === f.id}
              onSelect={() => onSelectFolder(f.id)}
              onRenameNode={onRenameNode}
              onDelete={onDeleteNode ? () => {
                if (confirm(`"${f.name}" を削除しますか?\n中のファイルも削除されます。`)) {
                  onDeleteNode(f.id);
                }
              } : undefined}
            />
          ))}
          {folders.length === 0 && (
            <div className="pl-[52px] pr-3 py-1 text-[12px] text-muted-foreground/50">
              No folders
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// FolderRow — depth-2 row inside a Cabinet. Click selects it (drives the
// middle pane's file list).
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
  const [renaming, setRenaming] = useState(false);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            'group flex items-center h-8 pl-2 pr-2',
            selected ? 'bg-accent' : 'hover:bg-muted/40',
          ].join(' ')}
        >
          {/* Spacer matching the Cabinet's chevron column so the Folder icon
              lines up directly under the Cabinet icon. */}
          <span className="w-4 flex-shrink-0" />
          <span className="w-5 h-5 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-2">
            <FolderClosed size={15} />
          </span>
          {renaming ? (
            <RenameInput
              initial={folder.name}
              onCommit={(v) => { if (v && v !== folder.name) onRenameNode?.(folder.id, v); setRenaming(false); }}
              onCancel={() => setRenaming(false)}
              className={['flex-1 min-w-0 bg-transparent text-[12px] font-semibold', selected ? 'text-foreground' : 'text-muted-foreground'].join(' ')}
            />
          ) : (
            <button
              type="button"
              onClick={onSelect}
              className="flex-1 min-w-0 flex items-center text-left h-full"
            >
              <span className={['text-[12px] font-semibold truncate', selected ? 'text-foreground' : 'text-muted-foreground'].join(' ')}>
                {folder.name}
              </span>
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-[170px]">
        {onRenameNode && (
          <ContextMenuItem className="gap-2" onSelect={() => setRenaming(true)}>
            <Pencil size={13} /> Rename
          </ContextMenuItem>
        )}
        {onDelete && (
          <>
            {onRenameNode && <ContextMenuSeparator />}
            <ContextMenuItem className="gap-2 text-destructive focus:text-destructive" onSelect={onDelete}>
              <Trash2 size={13} /> Delete folder
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// Inline rename field used by Cabinet / Folder rows. Enter commits, Esc
// cancels, blur commits. Guards the IME-confirm Enter (isComposing) so a
// Japanese conversion-commit doesn't submit the rename early.
function RenameInput({
  initial,
  onCommit,
  onCancel,
  className = '',
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <input
      autoFocus
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onCommit(e.currentTarget.value.trim());
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => onCommit(e.currentTarget.value.trim())}
      className={`no-focus-ring outline-none border-0 p-0 ${className}`}
    />
  );
}

// ============================================
// ============================================

/** Empty state shown in the editor area when no file is selected (or no
 *  files exist at all). Kept here for back-compat with the MainContent
 *  import; the OneNote layout reduces how often it's actually visible. */
export function BriefsEmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-center px-8 py-12">
      <div className="max-w-sm">
        <p className="text-[13px] text-muted-foreground mb-1">No file selected</p>
        <p className="text-[12px] text-muted-foreground/70">
          Pick a folder on the left and a file in the middle pane to start writing.
        </p>
      </div>
    </div>
  );
}
