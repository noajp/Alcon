'use client';

import { useState } from 'react';
import type { TicketNode } from './types';

interface TicketFilesSidebarProps {
  nodes: TicketNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
}

export function TicketFilesSidebar({ nodes, selectedFileId, onSelectFile }: TicketFilesSidebarProps) {
  // Sort: folders first, then alphabetically.
  const sorted = [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const roots = sorted.filter((n) => n.parentId === null);
  const childrenOf = (id: string) => sorted.filter((n) => n.parentId === id);

  return (
    <aside className="w-[240px] shrink-0 border-r border-border bg-background flex flex-col overflow-hidden">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Tickets
        </span>
      </div>
      <div className="flex-1 overflow-auto pb-3">
        {roots.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            depth={0}
            childrenOf={childrenOf}
            selectedFileId={selectedFileId}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    </aside>
  );
}

interface NodeRowProps {
  node: TicketNode;
  depth: number;
  childrenOf: (id: string) => TicketNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
}

function NodeRow({ node, depth, childrenOf, selectedFileId, onSelectFile }: NodeRowProps) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.type === 'folder';
  const children = isFolder ? childrenOf(node.id) : [];
  const isSelected = !isFolder && node.id === selectedFileId;

  const handleClick = () => {
    if (isFolder) setExpanded((v) => !v);
    else onSelectFile(node.id);
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={[
          'group w-full flex items-center h-[22px] text-left transition-colors duration-75',
          isSelected ? 'bg-accent' : 'hover:bg-accent',
        ].join(' ')}
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
            />
          ))}
        </div>
      )}
    </div>
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

export function TicketsEmptyState() {
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
