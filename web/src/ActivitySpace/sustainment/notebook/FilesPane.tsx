'use client';

import { useMemo, useState } from 'react';
import { FileText, FilePlus, Pencil, Plus, Trash2 } from 'lucide-react';
import type { NoteNode } from './types';
import { RenameInput } from './RenameInput';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui/context-menu';

interface FilesPaneProps {
  /** Header context — the selected Folder's name. Falls back to a placeholder
   *  when no folder is selected so the column isn't blank. */
  folderName: string | null;
  /** The Folder's Sections, in display order. */
  sections: NoteNode[];
  /** Pages of each Section (keyed by Section id) plus, under the folder id
   *  itself, the pages that sit directly in the Folder. */
  filesByParent: Record<string, NoteNode[]>;
  folderId: string | null;
  activeSectionId: string | null;
  selectedFileId: string | null;
  onSelectSection: (id: string) => void;
  onSelectFile: (id: string) => void;
  /** Create a new page under a Section (or the Folder). Hidden when omitted
   *  (read-only states). */
  onAddFile?: (parentId: string) => void;
  onAddSection?: () => void;
  onRenameNode?: (id: string, name: string) => void;
  onDeleteFile?: (id: string) => void;
  onDeleteSection?: (id: string) => void;
}

/**
 * Middle pane of the Note layout, between the Folder sidebar (left) and the
 * PageView editor (right). Every Section of the open Folder is listed, always
 * visible, with its pages beneath it — nothing hides behind a drawer. Rows
 * carry their actions on a right-click (Rename / Delete / New page) and the
 * list ends in "New section", so adding one is one click away.
 *
 * Title-only vertical list — no preview, no timestamp — to keep this column
 * narrow and the editor as wide as possible.
 */
export function FilesPane({
  folderName,
  sections,
  filesByParent,
  folderId,
  activeSectionId,
  selectedFileId,
  onSelectSection,
  onSelectFile,
  onAddFile,
  onAddSection,
  onRenameNode,
  onDeleteFile,
  onDeleteSection,
}: FilesPaneProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  // Stable alpha sort per group — matches the sidebar's sibling sort so a
  // freshly created page lands where the user expects on the next render.
  const sorted = useMemo(() => {
    const out: Record<string, NoteNode[]> = {};
    for (const [parent, files] of Object.entries(filesByParent)) out[parent] = [...files].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [filesByParent]);
  const looseFiles = folderId ? sorted[folderId] ?? [] : [];

  const fileRow = (file: NoteNode) => {
    const selected = file.id === selectedFileId;
    const row = (
      <div
        className={[
          'group flex w-full items-center gap-2 pl-7 pr-3 py-1.5 text-[12px] font-semibold transition-colors min-w-0',
          selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        ].join(' ')}
      >
        <FileText size={14} className="shrink-0" />
        {renaming === file.id ? (
          <RenameInput
            initial={file.name}
            onCommit={(v) => { if (v && v !== file.name) onRenameNode?.(file.id, v); setRenaming(null); }}
            onCancel={() => setRenaming(null)}
            className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-foreground"
          />
        ) : (
          <button type="button" onClick={() => onSelectFile(file.id)} className="min-w-0 flex-1 truncate text-left" title={file.name}>
            {file.name || 'Untitled'}
          </button>
        )}
      </div>
    );
    if (!onRenameNode && !onDeleteFile) return <div key={file.id}>{row}</div>;
    return (
      <ContextMenu key={file.id}>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-[170px]">
          {onRenameNode && <ContextMenuItem onSelect={() => setRenaming(file.id)}><Pencil /> Rename</ContextMenuItem>}
          {onDeleteFile && (
            <>
              {onRenameNode && <ContextMenuSeparator />}
              <ContextMenuItem variant="destructive" onSelect={() => onDeleteFile(file.id)}><Trash2 /> Delete page</ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const sectionRow = (section: NoteNode) => {
    const active = section.id === activeSectionId;
    const row = (
      <div
        className={[
          'group flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-semibold transition-colors min-w-0',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        <span className={`h-4 w-[3px] shrink-0 rounded-full ${active ? 'bg-[var(--accent-default)]' : 'bg-[var(--text-tertiary)]'}`} />
        {renaming === section.id ? (
          <RenameInput
            initial={section.name}
            onCommit={(v) => { if (v && v !== section.name) onRenameNode?.(section.id, v); setRenaming(null); }}
            onCancel={() => setRenaming(null)}
            className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-foreground"
          />
        ) : (
          <button type="button" onClick={() => onSelectSection(section.id)} className="min-w-0 flex-1 truncate text-left" title={section.name}>
            {section.name}
          </button>
        )}
        {onAddFile && (
          <button
            type="button"
            onClick={() => onAddFile(section.id)}
            title="New page"
            aria-label={`New page in ${section.name}`}
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Plus size={13} strokeWidth={2.5} />
          </button>
        )}
      </div>
    );
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-[170px]">
          {onAddFile && <ContextMenuItem onSelect={() => onAddFile(section.id)}><FilePlus /> New page</ContextMenuItem>}
          {onRenameNode && <ContextMenuItem onSelect={() => setRenaming(section.id)}><Pencil /> Rename</ContextMenuItem>}
          {onDeleteSection && (
            <>
              {(onAddFile || onRenameNode) && <ContextMenuSeparator />}
              <ContextMenuItem variant="destructive" onSelect={() => onDeleteSection(section.id)}><Trash2 /> Delete section</ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const empty = sections.length === 0 && looseFiles.length === 0;

  return (
    <aside className="w-full sm:w-60 shrink-0 flex flex-col border-r border-border/40 bg-card/30">
      {/* Header — h-[50px] + bottom divider lines this header up with the
          editor's toolbar header so the two panes share one header band. */}
      <div className="flex items-center gap-2 h-[50px] px-3 border-b border-border/30">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{folderName ?? ''}</span>
        {onAddSection && (
          <button
            type="button"
            onClick={onAddSection}
            title="New section"
            aria-label="New section"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          >
            <Plus size={14} strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {empty && !folderName && (
          <div className="px-3 py-6 text-center text-[11px] leading-relaxed text-muted-foreground/60">Select a folder to see its pages</div>
        )}
        {sections.map((section) => (
          <div key={section.id} className="pt-1">
            {sectionRow(section)}
            {(sorted[section.id] ?? []).map(fileRow)}
            {(sorted[section.id] ?? []).length === 0 && onAddFile && (
              <button
                type="button"
                onClick={() => onAddFile(section.id)}
                className="w-full py-1.5 pl-7 pr-3 text-left text-[11px] text-muted-foreground/60 transition-colors hover:text-foreground"
              >
                No pages yet — click to create
              </button>
            )}
          </div>
        ))}
        {looseFiles.length > 0 && (
          <div className="pt-1">
            {sections.length > 0 && <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground/60">Pages</div>}
            {looseFiles.map(fileRow)}
          </div>
        )}
        {folderName && onAddSection && (
          <button
            type="button"
            onClick={onAddSection}
            className="mt-1 flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Plus size={14} strokeWidth={2.5} className="shrink-0" /> New section
          </button>
        )}
      </div>
    </aside>
  );
}
