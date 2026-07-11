'use client';

import { useMemo } from 'react';
import { FileText, Menu, Trash2 } from 'lucide-react';
import type { NoteNode } from './types';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/ui/context-menu';

interface FilesPaneProps {
  /** Header context — the selected Folder's name. Falls back to a placeholder
   *  when no folder is selected so the column isn't blank. */
  folderName: string | null;
  files: NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  /** Create a new page — the empty-state prompt calls this (the header "+"
   *  moved to the breadcrumb). Hidden when omitted (read-only states). */
  onAddFile?: () => void;
  onDeleteFile?: (id: string) => void;
  /** Active Section's name — shown in the header beside the hamburger. */
  activeSectionName?: string | null;
  /** Hamburger → opens the Section drawer (owned by MainContent so it can
   *  cover the breadcrumb above this pane). Omitted while no folder is open. */
  onOpenSections?: () => void;
}

/**
 * Middle pane of the Note layout. Lives between the Folder sidebar (left) and
 * the PageView editor (right). Shows the page titles for the active Section;
 * the header hamburger opens the full-column Section drawer (OneNote-style).
 *
 * Title-only vertical list — no preview, no timestamp — to keep this column
 * narrow and the editor as wide as possible.
 */
export function FilesPane({
  folderName,
  files,
  selectedFileId,
  onSelectFile,
  onAddFile,
  onDeleteFile,
  activeSectionName,
  onOpenSections,
}: FilesPaneProps) {
  // Stable alpha sort — matches the sidebar's sibling sort so a freshly
  // created file lands where the user expects on the next render.
  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );

  return (
    <aside className="w-full sm:w-60 shrink-0 flex flex-col border-r border-border/40 bg-card/30">
      {/* Header — hamburger (opens Section drawer) + active Section name.
          h-[50px] + bottom divider lines this header up with the editor's
          toolbar header so the two panes share one header band. */}
      {/* gap-2 + px-3 + a w-6 leading slot match the file rows below so the
          Section name and file names line up on the same left edge. */}
      <div className="flex items-center gap-2 h-[50px] px-3 border-b border-border/30">
        {onOpenSections && (
          <button
            type="button"
            onClick={onOpenSections}
            title="Sections"
            aria-label="Open Sections"
            className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0"
          >
            <Menu size={16} />
          </button>
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
          {activeSectionName ?? ''}
        </span>
      </div>

      {/* Body — page list. */}
      <div className="flex-1 overflow-y-auto pb-2">
        {sortedFiles.length === 0 ? (
          folderName && onAddFile ? (
            // The header "+" moved to the breadcrumb, so the empty prompt
            // itself creates the first page.
            <button
              type="button"
              onClick={onAddFile}
              className="w-full px-3 py-6 text-[11px] text-muted-foreground/60 hover:text-foreground text-center leading-relaxed transition-colors"
            >
              No pages yet — click to create
            </button>
          ) : (
            <div className="px-3 py-6 text-[11px] text-muted-foreground/60 text-center leading-relaxed">
              {folderName ? 'No pages yet' : 'Select a folder to see its pages'}
            </div>
          )
        ) : (
          sortedFiles.map((file) => {
            const selected = file.id === selectedFileId;
            const row = (
              <button
                type="button"
                onClick={() => onSelectFile(file.id)}
                className={[
                  'group w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] font-semibold transition-colors min-w-0',
                  selected
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                ].join(' ')}
                title={file.name}
              >
                <span className="w-6 flex items-center justify-center shrink-0 text-muted-foreground">
                  <FileText size={16} />
                </span>
                <span className="truncate flex-1">{file.name || 'Untitled'}</span>
              </button>
            );
            if (!onDeleteFile) return <div key={file.id}>{row}</div>;
            return (
              <ContextMenu key={file.id}>
                <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                <ContextMenuContent className="min-w-[160px]">
                  <ContextMenuItem
                    className="gap-2 text-red-600 focus:text-red-600"
                    onClick={() => onDeleteFile(file.id)}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })
        )}
      </div>
    </aside>
  );
}
