'use client';

import { useMemo, useState } from 'react';
import {
  ChevronRight,
  FolderClosed,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Notebook,
  Plus,
  Trash2,
} from 'lucide-react';
import type { NoteNode, NoteNodeType } from './types';
import type { Domain } from '@/types/database';
import { unfiledFolderId } from './noteTree';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

// OneNote-style 2-tier sidebar: Cabinet → Folder. Files live in the middle
// pane (FilesPane), not here. Each Cabinet expands to its Folders plus an
// "Unfiled" pseudo-folder when the Cabinet owns any files directly (DB
// allows file rows whose parent is a notebook instead of a folder).
//
// UI terminology = Cabinet / Folder / File. DB types stay 'notebook' /
// 'folder' / 'file' (see types/notes.ts). The synthetic Unfiled-folder id
// helpers live in ./noteTree (shared with FilesPane + MainContent).

interface NotesSidebarProps {
  nodes: NoteNode[];
  selectedFolderId: string | null;
  /** Folder click handler. `id` may be a real folder id OR a synthetic
   *  `unfiled:<cabinetId>` string — the host filters its file list
   *  accordingly via `isUnfiledFolderId` / `cabinetIdFromUnfiled`. */
  onSelectFolder: (id: string) => void;
  /** Create a node.
   *  - type='notebook' → parentId is ignored, always at root.
   *  - type='folder'   → parentId must be a cabinet (notebook) id.
   *  - type='file'     → not used from this component (FilesPane owns file
   *    creation), kept on the type for API parity. */
  onCreateNode?: (type: NoteNodeType, parentId: string | null) => void;
  onDeleteNode?: (id: string) => void;
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
  domains,
  onSetLinkedDomain,
}: NotesSidebarProps) {
  // Pre-index nodes once per render so the inner rows can ask "what's under
  // X?" without re-walking the array each time.
  const { cabinets, foldersByCabinet, hasDirectFiles } = useMemo(() => {
    const cabinets: NoteNode[] = [];
    const foldersByCabinet = new Map<string, NoteNode[]>();
    const hasDirectFiles = new Set<string>(); // cabinet ids with file children
    for (const n of nodes) {
      if (n.type === 'notebook') {
        cabinets.push(n);
      } else if (n.type === 'folder' && n.parentId) {
        const list = foldersByCabinet.get(n.parentId) ?? [];
        list.push(n);
        foldersByCabinet.set(n.parentId, list);
      } else if (n.type === 'file' && n.parentId) {
        // A file whose parent is a cabinet (not a folder) → surface its
        // cabinet so we render an "Unfiled" pseudo-folder there.
        const parent = nodes.find((p) => p.id === n.parentId);
        if (parent?.type === 'notebook') hasDirectFiles.add(n.parentId);
      }
    }
    cabinets.sort((a, b) => a.name.localeCompare(b.name));
    for (const list of foldersByCabinet.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return { cabinets, foldersByCabinet, hasDirectFiles };
  }, [nodes]);

  return (
    <aside className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Cabinets header */}
      <div className="flex items-center px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Cabinets
        </span>
        <div className="flex-1" />
        {onCreateNode && (
          <button
            type="button"
            onClick={() => onCreateNode('notebook', null)}
            className="text-muted-foreground hover:text-foreground p-0.5"
            title="New cabinet"
            aria-label="New cabinet"
          >
            <Plus size={14} />
          </button>
        )}
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
            hasUnfiled={hasDirectFiles.has(cab.id)}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onCreateNode={onCreateNode}
            onDeleteNode={onDeleteNode}
            domains={domains}
            onSetLinkedDomain={onSetLinkedDomain}
          />
        ))}
      </div>
    </aside>
  );
}

// ============================================
// CabinetRow — expandable row with folder children + optional Unfiled
// pseudo-folder. Hover reveals "+ Folder" and a kebab menu (Domain link +
// delete).
// ============================================

interface CabinetRowProps {
  cabinet: NoteNode;
  folders: NoteNode[];
  hasUnfiled: boolean;
  selectedFolderId: string | null;
  onSelectFolder: (id: string) => void;
  onCreateNode?: (type: NoteNodeType, parentId: string | null) => void;
  onDeleteNode?: (id: string) => void;
  domains?: Domain[];
  onSetLinkedDomain?: (cabinetId: string, domainId: string | null) => void;
}

function CabinetRow({
  cabinet,
  folders,
  hasUnfiled,
  selectedFolderId,
  onSelectFolder,
  onCreateNode,
  onDeleteNode,
  domains,
  onSetLinkedDomain,
}: CabinetRowProps) {
  const [expanded, setExpanded] = useState(true);
  const linkedDomain = domains?.find((d) => d.id === cabinet.linkedDomainId) ?? null;
  const unfiledId = unfiledFolderId(cabinet.id);

  return (
    <div>
      <div className="group flex items-center h-[26px] hover:bg-accent">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center h-full text-left pl-2"
        >
          <span
            className={[
              'w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform duration-100',
              expanded ? 'rotate-90' : '',
            ].join(' ')}
          >
            <ChevronRight size={12} />
          </span>
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
            <Notebook size={14} />
          </span>
          <span className="text-[13px] font-semibold truncate text-foreground/90">
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
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onCreateNode && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCreateNode('folder', cabinet.id); }}
              className="text-muted-foreground hover:text-foreground p-1"
              title="New folder in this cabinet"
              aria-label="New folder"
            >
              <FolderPlus size={13} />
            </button>
          )}
          {(domains || onDeleteNode) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground px-1.5"
                  aria-label="More"
                  title="More"
                >
                  <MoreHorizontal size={13} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px] rounded-xl">
                {domains && domains.length > 0 && onSetLinkedDomain && (
                  <>
                    <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Link domain
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); onSetLinkedDomain(cabinet.id, null); }}
                      className="text-[13px] gap-2 rounded-md"
                    >
                      <span className="text-muted-foreground">No link</span>
                    </DropdownMenuItem>
                    {domains.map((d) => (
                      <DropdownMenuItem
                        key={d.id}
                        onSelect={(e) => { e.preventDefault(); onSetLinkedDomain(cabinet.id, d.id); }}
                        className="text-[13px] gap-2 rounded-md"
                      >
                        <span className="flex-1 truncate">{d.name}</span>
                      </DropdownMenuItem>
                    ))}
                    {onDeleteNode && <DropdownMenuSeparator />}
                  </>
                )}
                {onDeleteNode && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      if (confirm(`"${cabinet.name}" を削除しますか?\n中のフォルダ・ファイルも削除されます。`)) {
                        onDeleteNode(cabinet.id);
                      }
                    }}
                    className="text-[13px] gap-2 rounded-md text-destructive focus:text-destructive"
                  >
                    <Trash2 size={13} /> Delete cabinet
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {expanded && (
        <div>
          {folders.map((f) => (
            <FolderRow
              key={f.id}
              folder={f}
              selected={selectedFolderId === f.id}
              onSelect={() => onSelectFolder(f.id)}
              onDelete={onDeleteNode ? () => {
                if (confirm(`"${f.name}" を削除しますか?\n中のファイルも削除されます。`)) {
                  onDeleteNode(f.id);
                }
              } : undefined}
            />
          ))}
          {hasUnfiled && (
            <UnfiledRow
              selected={selectedFolderId === unfiledId}
              onSelect={() => onSelectFolder(unfiledId)}
            />
          )}
          {folders.length === 0 && !hasUnfiled && (
            <div className="pl-9 pr-3 py-1 text-[11px] text-muted-foreground/50">
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
  onDelete,
}: {
  folder: NoteNode;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={[
        'group flex items-center h-[26px]',
        selected ? 'bg-accent' : 'hover:bg-muted/40',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 flex items-center h-full text-left pl-9 pr-2"
      >
        <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1.5">
          <FolderClosed size={14} />
        </span>
        <span className={['text-[13px] truncate', selected ? 'text-foreground' : 'text-foreground/80'].join(' ')}>
          {folder.name}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive px-1.5 transition-opacity"
          title="Delete folder"
          aria-label="Delete folder"
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  );
}

// ============================================
// UnfiledRow — synthetic per-cabinet row that surfaces files parked under
// the cabinet directly (no folder). Italicised + faded so it reads as a
// pseudo entry, not a real folder.
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

function UnfiledRow({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        'w-full flex items-center h-[26px] pl-9 pr-2 text-left',
        selected ? 'bg-accent' : 'hover:bg-muted/40',
      ].join(' ')}
    >
      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground/70 mr-1.5">
        <Inbox size={14} />
      </span>
      <span className={['text-[13px] italic truncate', selected ? 'text-foreground/85' : 'text-foreground/60'].join(' ')}>
        Unfiled
      </span>
    </button>
  );
}
