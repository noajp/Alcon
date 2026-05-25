'use client';

import { useMemo, useState } from 'react';
import type { NoteNode, NoteNodeType } from './types';
import type { Domain } from '@/types/database';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

// 3-tier sidebar: Notebook → Folder → File.
//
// Notebooks are the root nodes (DB CHECK enforces this). Each notebook
// expands into its folder/file subtree, and exposes per-notebook
// affordances (rename / delete / link a Domain / create a folder or
// file beneath). Folders sit one level down and can only hold files —
// they don't nest further. Files are leaves.

interface NotesSidebarProps {
  nodes: NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  /** Create a node.
   *  - type='notebook' → parentId is ignored, always at root.
   *  - type='folder'   → parentId must be a notebook id.
   *  - type='file'     → parentId must be a notebook or folder id. */
  onCreateNode?: (type: NoteNodeType, parentId: string | null) => void;
  onDeleteNode?: (id: string) => void;
  /** Move a Note (folder or file) under a different parent. Pass null
   *  to promote to root only when moving a notebook; folders/files
   *  must land on another node. */
  onMoveNode?: (id: string, parentId: string | null) => void;
  /** Domain list for the notebook → Domain picker. When omitted the
   *  picker is hidden. */
  domains?: Domain[];
  /** Persist a notebook's linked Domain (or null to clear). */
  onSetLinkedDomain?: (notebookId: string, domainId: string | null) => void;
}

export function NotesSidebar({
  nodes,
  selectedFileId,
  onSelectFile,
  onCreateNode,
  onDeleteNode,
  onMoveNode,
  domains,
  onSetLinkedDomain,
}: NotesSidebarProps) {
  // Sort siblings: folders before files inside a notebook; alpha as tiebreaker.
  const sorted = useMemo(
    () =>
      [...nodes].sort((a, b) => {
        if (a.type !== b.type) {
          // notebook always lowest (we read roots separately), then folder, then file.
          const rank: Record<NoteNodeType, number> = { notebook: 0, folder: 1, file: 2 };
          return rank[a.type] - rank[b.type];
        }
        return a.name.localeCompare(b.name);
      }),
    [nodes],
  );

  const notebooks = sorted.filter((n) => n.type === 'notebook');
  const childrenOf = (id: string) => sorted.filter((n) => n.parentId === id);
  // Available move-targets for non-notebook nodes: folders inside the
  // same notebook + the notebook itself. We pass the flat list and let
  // the per-row menu filter further (descendants etc.).
  const containers = useMemo(
    () => sorted.filter((n) => n.type === 'notebook' || n.type === 'folder'),
    [sorted],
  );

  const handleCreateNotebook = onCreateNode
    ? () => onCreateNode('notebook', null)
    : undefined;

  return (
    <aside className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {/* Notebook list header with "+ Notebook" affordance. */}
      <div className="flex items-center px-3 pt-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          Notebooks
        </span>
        <div className="flex-1" />
        {handleCreateNotebook && (
          <button
            type="button"
            onClick={handleCreateNotebook}
            className="text-muted-foreground hover:text-foreground p-0.5"
            title="New notebook"
            aria-label="New notebook"
          >
            <PlusIcon />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto pb-3">
        {notebooks.length === 0 && (
          <div className="px-3 py-4 text-[11px] text-muted-foreground/60 text-center">
            No notebooks yet — click + to create one
          </div>
        )}
        {notebooks.map((nb) => (
          <NotebookRow
            key={nb.id}
            notebook={nb}
            childrenOf={childrenOf}
            containers={containers}
            selectedFileId={selectedFileId}
            onSelectFile={onSelectFile}
            onCreateNode={onCreateNode}
            onDeleteNode={onDeleteNode}
            onMoveNode={onMoveNode}
            domains={domains}
            onSetLinkedDomain={onSetLinkedDomain}
          />
        ))}
      </div>
    </aside>
  );
}

// ============================================
// NotebookRow — root-level row with notebook icon, Domain badge, and
// inline + Folder / + Note quick-create buttons.
// ============================================

interface NotebookRowProps {
  notebook: NoteNode;
  childrenOf: (id: string) => NoteNode[];
  containers: NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onCreateNode?: (type: NoteNodeType, parentId: string | null) => void;
  onDeleteNode?: (id: string) => void;
  onMoveNode?: (id: string, parentId: string | null) => void;
  domains?: Domain[];
  onSetLinkedDomain?: (notebookId: string, domainId: string | null) => void;
}

function NotebookRow({
  notebook,
  childrenOf,
  containers,
  selectedFileId,
  onSelectFile,
  onCreateNode,
  onDeleteNode,
  onMoveNode,
  domains,
  onSetLinkedDomain,
}: NotebookRowProps) {
  const [expanded, setExpanded] = useState(true);
  const children = childrenOf(notebook.id);
  const linkedDomain = domains?.find((d) => d.id === notebook.linkedDomainId) ?? null;

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
            <ChevronIcon />
          </span>
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
            <NotebookIcon />
          </span>
          <span className="text-[13px] font-semibold truncate text-foreground/90">
            {notebook.name}
          </span>
          {linkedDomain && (
            <span
              className="ml-2 inline-flex items-center gap-1 px-1.5 h-4 rounded text-[10px] bg-muted text-muted-foreground"
              title={`Linked to domain: ${linkedDomain.name}`}
            >
              <DomainDotIcon />
              <span className="truncate max-w-[60px]">{linkedDomain.name}</span>
            </span>
          )}
        </button>
        {/* Inline + Folder / + Note quick-create */}
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {onCreateNode && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCreateNode('folder', notebook.id); }}
                className="text-muted-foreground hover:text-foreground p-1"
                title="New folder in this notebook"
                aria-label="New folder"
              >
                <FolderPlusIcon />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCreateNode('file', notebook.id); }}
                className="text-muted-foreground hover:text-foreground p-1"
                title="New note in this notebook"
                aria-label="New note"
              >
                <FilePlusIcon />
              </button>
            </>
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
                  <MoreIcon />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[200px] rounded-xl">
                {domains && domains.length > 0 && onSetLinkedDomain && (
                  <>
                    <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Link domain
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={(e) => { e.preventDefault(); onSetLinkedDomain(notebook.id, null); }}
                      className="text-[13px] gap-2 rounded-md"
                    >
                      <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">∅</span>
                      <span>No link</span>
                      {!notebook.linkedDomainId && <CheckMarkIcon />}
                    </DropdownMenuItem>
                    {domains.map((d) => (
                      <DropdownMenuItem
                        key={d.id}
                        onSelect={(e) => { e.preventDefault(); onSetLinkedDomain(notebook.id, d.id); }}
                        className="text-[13px] gap-2 rounded-md"
                      >
                        <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">
                          <DomainDotIcon />
                        </span>
                        <span className="flex-1 truncate">{d.name}</span>
                        {notebook.linkedDomainId === d.id && <CheckMarkIcon />}
                      </DropdownMenuItem>
                    ))}
                    {onDeleteNode && <DropdownMenuSeparator />}
                  </>
                )}
                {onDeleteNode && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      if (confirm(`"${notebook.name}" を削除しますか?\n中のフォルダ・Noteも削除されます。`)) {
                        onDeleteNode(notebook.id);
                      }
                    }}
                    className="text-[13px] gap-2 rounded-md text-destructive focus:text-destructive"
                  >
                    <TrashIcon />
                    <span>Delete notebook</span>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {expanded && children.length > 0 && (
        <div>
          {children.map((c) => (
            <NodeRow
              key={c.id}
              node={c}
              depth={1}
              childrenOf={childrenOf}
              selectedFileId={selectedFileId}
              onSelectFile={onSelectFile}
              onCreateNode={onCreateNode}
              onDeleteNode={onDeleteNode}
              onMoveNode={onMoveNode}
              allContainers={containers}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// NodeRow — folder / file row (depth ≥ 1).
// ============================================

interface NodeRowProps {
  node: NoteNode;
  depth: number;
  childrenOf: (id: string) => NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  onCreateNode?: (type: NoteNodeType, parentId: string | null) => void;
  onDeleteNode?: (id: string) => void;
  onMoveNode?: (id: string, parentId: string | null) => void;
  allContainers: NoteNode[];
}

function NodeRow({
  node,
  depth,
  childrenOf,
  selectedFileId,
  onSelectFile,
  onCreateNode,
  onDeleteNode,
  onMoveNode,
  allContainers,
}: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.type === 'folder';
  const children = isFolder ? childrenOf(node.id) : [];
  const isSelected = !isFolder && node.id === selectedFileId;

  const handleClick = () => {
    if (isFolder) setExpanded((v) => !v);
    else onSelectFile(node.id);
  };

  // Move targets: notebooks + folders, minus self + current parent +
  // any descendant (would create a cycle).
  const moveTargets = useMemo(() => {
    if (!onMoveNode) return [] as NoteNode[];
    return allContainers.filter((c) => {
      if (c.id === node.id) return false;
      if (c.id === node.parentId) return false;
      // Folders only allow files (no folder-in-folder per UX); when
      // moving a folder, restrict to notebooks.
      if (node.type === 'folder' && c.type !== 'notebook') return false;
      // Cycle check — walk c's ancestor chain.
      let cur: NoteNode | null = c;
      const byId = new Map(allContainers.map((x) => [x.id, x] as const));
      while (cur) {
        if (cur.parentId === node.id) return false;
        cur = cur.parentId ? byId.get(cur.parentId) ?? null : null;
      }
      return true;
    });
  }, [allContainers, node.id, node.parentId, node.type, onMoveNode]);

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
          <span
            className={[
              'w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground transition-transform duration-100',
              isFolder ? '' : 'invisible',
              expanded ? 'rotate-90' : '',
            ].join(' ')}
          >
            <ChevronIcon />
          </span>
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-muted-foreground mr-1">
            {node.icon ? (
              <span className="text-sm">{node.icon}</span>
            ) : isFolder ? (
              <FolderIcon />
            ) : (
              <FileIcon />
            )}
          </span>
          <span className="text-[13px] flex-1 truncate text-foreground/80">
            {node.name}
          </span>
        </button>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {isFolder && onCreateNode && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCreateNode('file', node.id); }}
              className="text-muted-foreground hover:text-foreground p-1"
              title="New note in this folder"
              aria-label="New note"
            >
              <FilePlusIcon />
            </button>
          )}
          {(onMoveNode || onDeleteNode) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground px-1.5"
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
                    {moveTargets.length === 0 ? (
                      <div className="px-3 py-1.5 text-[11px] text-muted-foreground/70">
                        No other parents
                      </div>
                    ) : (
                      moveTargets.map((c) => (
                        <DropdownMenuItem
                          key={c.id}
                          onSelect={(e) => { e.preventDefault(); onMoveNode(node.id, c.id); }}
                          className="text-[13px] gap-2 rounded-md"
                        >
                          <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">
                            {c.type === 'notebook' ? <NotebookIcon /> : <FolderIcon />}
                          </span>
                          <span className="flex-1 truncate">{c.name}</span>
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
              onCreateNode={onCreateNode}
              onDeleteNode={onDeleteNode}
              onMoveNode={onMoveNode}
              allContainers={allContainers}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Icons (kept inline so the sidebar has no extra deps).
// ============================================

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

function NotebookIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function FilePlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function DomainDotIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

function CheckMarkIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/80">
      <polyline points="20 6 9 17 4 12" />
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
