'use client';

import { useMemo, useState } from 'react';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import type { NoteNode } from '@/types/notes';
import { RenameInput } from './RenameInput';
import { useI18n } from '@/Function/i18n/I18nProvider';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/ui/context-menu';

interface FilesPaneProps {
  /** Header context — the active Section's name, or the Folder's while it
   *  has no Sections. Falls back to a placeholder when nothing is open. */
  title: string | null;
  files: NoteNode[];
  selectedFileId: string | null;
  onSelectFile: (id: string) => void;
  /** Create a new page in the active Section (or the Folder). Hidden when
   *  omitted (read-only states). */
  onAddFile?: () => void;
  onRenameNode?: (id: string, name: string) => void;
  onDeleteFile?: (id: string) => void;
}

/**
 * Middle pane of the Note layout, between the sidebar's Book / Section tree
 * (left) and the PageView editor (right). Lists the pages of the Section the
 * sidebar picked — only pages; Books and Sections are the sidebar's. Rows
 * carry Rename / Delete on a right-click and the list ends in "New page".
 *
 * Title-only vertical list — no preview, no timestamp — to keep this column
 * narrow and the editor as wide as possible.
 */
export function FilesPane({
  title,
  files,
  selectedFileId,
  onSelectFile,
  onAddFile,
  onRenameNode,
  onDeleteFile,
}: FilesPaneProps) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  // Radix hands focus back to the trigger as the menu closes; renaming after
  // that, with the menu's own auto-focus off, lets the field keep it.
  const startRename = (id: string) => { window.setTimeout(() => setRenaming(id), 0); };
  // Stable alpha sort — matches the sidebar's sibling sort so a freshly
  // created page lands where the user expects on the next render.
  const sortedFiles = useMemo(
    () => [...files].sort((a, b) => a.name.localeCompare(b.name)),
    [files],
  );

  return (
    <aside className="w-full sm:w-60 shrink-0 flex flex-col border-r border-border/40 bg-card/30">
      {/* Header — h-[50px] + bottom divider lines this header up with the
          editor's toolbar header so the two panes share one header band. */}
      <div className="flex items-center gap-2 h-[50px] px-3 border-b border-border/30">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">{title ?? ''}</span>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {!title && (
          <div className="px-3 py-6 text-center text-[11px] leading-relaxed text-muted-foreground/60">{t('Select a notebook to see its pages')}</div>
        )}
        {sortedFiles.map((file) => {
          const selected = file.id === selectedFileId;
          const row = (
            <div
              className={[
                'group flex w-full items-center gap-2 px-3 py-1.5 text-[12px] font-semibold transition-colors min-w-0',
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
                  {file.name || t('Untitled')}
                </button>
              )}
            </div>
          );
          if (!onRenameNode && !onDeleteFile) return <div key={file.id}>{row}</div>;
          return (
            <ContextMenu key={file.id}>
              <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
              <ContextMenuContent className="min-w-[170px]" onCloseAutoFocus={(e) => e.preventDefault()}>
                {onRenameNode && <ContextMenuItem onSelect={() => startRename(file.id)}><Pencil /> {t('Rename')}</ContextMenuItem>}
                {onDeleteFile && (
                  <>
                    {onRenameNode && <ContextMenuSeparator />}
                    <ContextMenuItem variant="destructive" onSelect={() => onDeleteFile(file.id)}><Trash2 /> {t('Delete page')}</ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
        {title && onAddFile && (
          <button
            type="button"
            onClick={onAddFile}
            className="mt-1 flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <Plus size={14} strokeWidth={2.5} className="shrink-0" /> {t('New page')}
          </button>
        )}
      </div>
    </aside>
  );
}
