'use client';

import { useMemo } from 'react';
import { FileText, SquarePen, Trash2 } from 'lucide-react';
import type { NoteNode } from './types';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/ui/context-menu';

interface FilesPaneProps {
  /** Header shown above the file list — the Folder name (or "Unfiled" for
   *  cabinet-direct files). Falls back to a placeholder when no folder is
   *  selected so the column isn't blank. */
  folderName: string | null;
  files: NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  /** Create a new file under the currently focused folder/cabinet. Hidden
   *  when omitted (e.g. read-only states). */
  onAddFile?: () => void;
  onDeleteFile?: (id: string) => void;
}

/**
 * Middle pane of the OneNote-style 3-pane Note layout. Lives between the
 * cabinet/folder sidebar (left) and the PageView editor (right). Shows the
 * file titles for the currently selected folder, plus an "Add page" affordance.
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
}: FilesPaneProps) {
  // Stable alpha sort — matches the sidebar's sibling sort so a freshly
  // created file lands where the user expects on the next render.
  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );

  return (
    <aside className="w-60 shrink-0 flex flex-col border-r border-border/40 bg-card/30">
      {/* Header — just the compose ("new page") button, right-aligned. The
          folder name was dropped (the sidebar already highlights the active
          folder); h-10 matches the sidebar title / window-tab row height. */}
      <div className="flex items-center justify-end h-10 px-2">
        {onAddFile && (
          <button
            type="button"
            onClick={onAddFile}
            disabled={!folderName}
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="New page"
            aria-label="New page"
          >
            <SquarePen size={16} />
          </button>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto pb-2">
        {sortedFiles.length === 0 ? (
          <div className="px-3 py-6 text-[11px] text-muted-foreground/60 text-center leading-relaxed">
            {folderName
              ? 'No files yet — click + to create'
              : 'Select a folder to see its files'}
          </div>
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
                <FileText size={15} className="shrink-0 text-muted-foreground" />
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
