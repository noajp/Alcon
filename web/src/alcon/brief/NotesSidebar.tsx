'use client';

import { useMemo, useState } from 'react';
import type { Brief, NoteNode, NoteNodeType } from './types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

interface NotesSidebarProps {
  nodes: NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  briefs: Brief[];
  onSelectBrief: (id: string) => void;
  onCreateNode?: (type: NoteNodeType) => void;
  onDeleteNode?: (id: string) => void;
  /** Move a Note (folder or file) under a different parent.
   *  parentId === null → promote to root. */
  onMoveNode?: (id: string, parentId: string | null) => void;
}

export function NotesSidebar({
  nodes,
  selectedFileId,
  onSelectFile,
  briefs,
  onSelectBrief,
  onCreateNode,
  onDeleteNode,
  onMoveNode,
}: NotesSidebarProps) {
  // Sort: folders first, then alphabetically.
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const roots = sorted.filter((n) => n.parentId === null);
  const childrenOf = (id: string) => sorted.filter((n) => n.parentId === id);
  // All folders — used by the per-row "Move to…" menu so files can be
  // shuffled in/out of folders without DnD.
  const folders = useMemo(() => sorted.filter((n) => n.type === 'folder'), [sorted]);

  return (
    <aside className="w-[240px] shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Notes
        </span>
        {onCreateNode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="New"
                title="New"
                className="w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent"
              >
                <PlusIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[160px]">
              <DropdownMenuItem onClick={() => onCreateNode('file')}>
                <FileIcon />
                <span className="ml-2">New Note</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreateNode('folder')}>
                <FolderIcon />
                <span className="ml-2">New Folder</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex-1 overflow-auto pb-3">
        {roots.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground/60 text-center">
            No notes yet — click + to create one
          </div>
        )}
        {roots.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            depth={0}
            childrenOf={childrenOf}
            selectedFileId={selectedFileId}
            onSelectFile={onSelectFile}
            onDeleteNode={onDeleteNode}
            onMoveNode={onMoveNode}
            allFolders={folders}
          />
        ))}
      </div>

      <BriefsPanel briefs={briefs} onSelectBrief={onSelectBrief} />
    </aside>
  );
}

// ============================================
// Briefs panel (collapsible, stuck to bottom)
// ============================================
function BriefsPanel({
  briefs,
  onSelectBrief,
}: {
  briefs: Brief[];
  onSelectBrief: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...briefs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div
      className={[
        'border-t border-border shrink-0 flex flex-col',
        expanded ? 'max-h-[260px]' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-1.5 h-[30px] px-3 hover:bg-accent text-left"
      >
        <span
          className={[
            'w-3 h-3 flex items-center justify-center text-muted-foreground transition-transform duration-100',
            expanded ? 'rotate-90' : '',
          ].join(' ')}
        >
          <ChevronIcon />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Briefs
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground/60 tabular-nums">
          {briefs.length}
        </span>
      </button>

      {expanded && (
        <div className="flex-1 overflow-auto pb-2">
          {sorted.length === 0 ? (
            <div className="px-3 py-3 text-[11px] text-muted-foreground/60">
              Brief で Note から作成できます
            </div>
          ) : (
            sorted.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectBrief(t.id)}
                className="w-full text-left px-3 py-1.5 hover:bg-accent flex flex-col gap-0.5"
                title={`${t.title}\n${t.sourceFileName}`}
              >
                <span className="text-[12px] text-foreground/90 truncate flex items-center gap-1.5">
                  <BriefDot />
                  {t.title}
                </span>
                <span className="text-[10px] text-muted-foreground/70 truncate pl-[14px]">
                  {t.sourceFileName}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BriefDot() {
  return (
    <span
      aria-hidden
      className="w-[8px] h-[8px] shrink-0 rounded-full"
      style={{ backgroundColor: '#8B5CF6' }}
    />
  );
}

interface NodeRowProps {
  node: NoteNode;
  depth: number;
  childrenOf: (id: string) => NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onDeleteNode?: (id: string) => void;
  onMoveNode?: (id: string, parentId: string | null) => void;
  allFolders: NoteNode[];
}

function NodeRow({ node, depth, childrenOf, selectedFileId, onSelectFile, onDeleteNode, onMoveNode, allFolders }: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.type === 'folder';
  const children = isFolder ? childrenOf(node.id) : [];
  const isSelected = !isFolder && node.id === selectedFileId;

  const handleClick = () => {
    if (isFolder) setExpanded((v) => !v);
    else onSelectFile(node.id);
  };

  // Folders the user can move this Note into. A folder can't be its own
  // ancestor (would create a cycle); a Note can't move into itself or
  // its current parent.
  const moveTargets = useMemo(() => {
    if (!onMoveNode) return [] as NoteNode[];
    return allFolders.filter((f) => {
      if (f.id === node.id) return false;
      if (f.id === node.parentId) return false;
      // For folders: prevent moving into descendants. Walk f's ancestor
      // chain — if `node` is in it, skip.
      let cur: NoteNode | null = f;
      const byId = new Map(allFolders.map((x) => [x.id, x] as const));
      while (cur) {
        if (cur.parentId === node.id) return false;
        cur = cur.parentId ? byId.get(cur.parentId) ?? null : null;
      }
      return true;
    });
  }, [allFolders, node.id, node.parentId, onMoveNode]);

  return (
    <div>
      <div
        className={[
          'group flex items-center h-[22px]',
          isSelected ? 'bg-accent' : 'hover:bg-accent',
        ].join(' ')}
      >
        <button
          type="button"
          onClick={handleClick}
          className="flex-1 min-w-0 flex items-center h-full text-left"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {/* Chevron for folders, spacer for files */}
          <span
            className={[
              'w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform duration-100',
              isFolder ? '' : 'invisible',
              expanded ? 'rotate-90' : '',
            ].join(' ')}
          >
            <ChevronIcon />
          </span>
          {/* Icon */}
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
            {node.icon ? (
              <span className="text-sm">{node.icon}</span>
            ) : isFolder ? (
              <FolderIcon />
            ) : (
              <FileIcon />
            )}
          </span>
          {/* Name */}
          <span className="text-[13px] flex-1 truncate text-foreground/80">
            {node.name}
          </span>
        </button>
        {(onMoveNode || onDeleteNode) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground px-1.5 shrink-0"
                aria-label="More"
                title="More"
              >
                <MoreIcon />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px] rounded-xl">
              {onMoveNode && (
                <>
                  <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Move to
                  </DropdownMenuLabel>
                  {node.parentId !== null && (
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); onMoveNode(node.id, null); }}
                      className="text-[13px] gap-2 rounded-md"
                    >
                      <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">↑</span>
                      <span>Top level</span>
                    </DropdownMenuItem>
                  )}
                  {moveTargets.length === 0 ? (
                    <div className="px-3 py-1.5 text-[11px] text-muted-foreground/70">
                      No other folders
                    </div>
                  ) : (
                    moveTargets.map((f) => (
                      <DropdownMenuItem
                        key={f.id}
                        onSelect={(e) => { e.preventDefault(); onMoveNode(node.id, f.id); }}
                        className="text-[13px] gap-2 rounded-md"
                      >
                        <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">
                          <FolderIcon />
                        </span>
                        <span className="flex-1 truncate">{f.name}</span>
                      </DropdownMenuItem>
                    ))
                  )}
                  {onDeleteNode && <DropdownMenuSeparator />}
                </>
              )}
              {onDeleteNode && (
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    if (confirm(`"${node.name}" を削除しますか?${isFolder ? '\n中のNoteも削除されます。' : ''}`)) {
                      onDeleteNode(node.id);
                    }
                  }}
                  className="text-[13px] gap-2 rounded-md text-destructive focus:text-destructive"
                >
                  <TrashIcon />
                  <span>Delete</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {isFolder && expanded && children.length > 0 && (
        <div>
          {children.map((c) => (
            <NodeRow
              key={c.id}
              node={c}
              depth={depth + 1}
              childrenOf={childrenOf}
              selectedFileId={selectedFileId}
              onSelectFile={onSelectFile}
              onDeleteNode={onDeleteNode}
              onMoveNode={onMoveNode}
              allFolders={allFolders}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function BriefsEmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[var(--card)]">
      <div className="text-center">
        <div className="mx-auto mb-3 w-10 h-10 flex items-center justify-center text-muted-foreground">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="4" width="13" height="16" rx="1.5" />
            <rect x="7" y="6" width="13" height="16" rx="1.5" fill="currentColor" fillOpacity="0.08" />
            <circle cx="9.5" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <p className="text-[13px] text-muted-foreground">
          サイドバーから File を選んで開いてください
        </p>
      </div>
    </div>
  );
}
