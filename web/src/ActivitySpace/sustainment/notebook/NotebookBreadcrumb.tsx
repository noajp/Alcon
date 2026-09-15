'use client';

import { ChevronRight, Plus } from 'lucide-react';

// Breadcrumb strip along the top of the Notebook surface — the open
// Notebook's name (click to go back to the notebook browser) plus a "+" to
// add a page (file) to the active Section. Sections are listed in the
// FilesPane, and new Notebooks are created from the notebook browser's "+",
// not here.
export function NotebookBreadcrumb({
  folderName,
  onBack,
  onAddFile,
}: {
  folderName: string | null;
  onBack: () => void;
  /** Create a new page in the active Section — the header "+". Hidden when
   *  omitted. */
  onAddFile?: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5 px-2 h-[50px] border-b border-border/60 bg-card flex-shrink-0">
      <button
        type="button"
        onClick={onBack}
        className="px-1.5 py-0.5 rounded text-[12px] font-semibold text-foreground hover:bg-muted/40 transition-colors shrink-0 truncate max-w-[240px]"
      >
        {folderName ?? 'Notebook'}
      </button>
      <ChevronRight size={12} className="text-muted-foreground/40 shrink-0" />
      <div className="flex-1" />
      {onAddFile && (
        <button
          type="button"
          onClick={onAddFile}
          title="New page"
          aria-label="New page"
          className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
