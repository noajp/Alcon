'use client';

import { useState } from 'react';
import { LayoutGrid, List, Notebook, Plus } from 'lucide-react';
import { NavNoteIcon } from '@/shell/sidebar/NavIcons';
import type { NoteNode } from './types';

const VIEW_MODE_KEY = 'alcon:notebook-view';
type ViewMode = 'grid' | 'list';

function loadViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'grid';
  return window.localStorage.getItem(VIEW_MODE_KEY) === 'list' ? 'list' : 'grid';
}

// The Notebook surface's landing state — a browser over the root Folders,
// switchable between a Finder-style icon grid and a flat list. Opening one
// switches to the Section tabs + file list + editor view. Folder creation
// stays in the sidebar's "+ Create new" menu.
export function FolderGrid({
  folders,
  sectionCounts,
  onOpenFolder,
  onAddFolder,
}: {
  folders: NoteNode[];
  /** Sections per folder id — the list view's "Section" column. */
  sectionCounts: Record<string, number>;
  onOpenFolder: (id: string) => void;
  /** Create a new Notebook — the header "+". Hidden when omitted. */
  onAddFolder?: () => void;
}) {
  const [mode, setMode] = useState<ViewMode>(loadViewMode);
  const switchMode = (next: ViewMode) => {
    setMode(next);
    try { window.localStorage.setItem(VIEW_MODE_KEY, next); } catch { /* non-fatal */ }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-card">
      <div className="h-[50px] flex items-center gap-1.5 pl-4 pr-2 border-b border-border/60 bg-card flex-shrink-0">
        <NavNoteIcon size={12} />
        <span className="text-[12px] font-semibold text-foreground">Notebook</span>
        <div className="flex-1" />
        {onAddFolder && (
          <button
            type="button"
            onClick={onAddFolder}
            title="Add Notebook"
            aria-label="Add Notebook"
            className="inline-flex items-center justify-center w-6 h-6 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* View-mode toolbar — sits right under the header divider. */}
      <div className="flex items-center justify-end gap-0.5 px-2 py-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={() => switchMode('list')}
          aria-label="List view"
          className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors ${
            mode === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          <List size={14} />
        </button>
        <button
          type="button"
          onClick={() => switchMode('grid')}
          aria-label="Grid view"
          className={`inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors ${
            mode === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          <LayoutGrid size={14} />
        </button>
      </div>

      {folders.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
          No notebooks yet — create one from the sidebar.
        </div>
      ) : mode === 'grid' ? (
        <div className="flex-1 overflow-auto">
          <div className="max-w-5xl mx-auto px-8 py-8 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-8">
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onOpenFolder(f.id)}
                className="group flex flex-col items-center gap-2 rounded-lg p-3 hover:bg-muted/30 transition-colors"
                title={f.name}
              >
                <Notebook
                  size={64}
                  strokeWidth={2}
                  className="text-muted-foreground/70 group-hover:text-foreground/80 transition-colors"
                />
                <span className="text-[13px] text-foreground/90 max-w-full truncate">{f.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        // List mode — the Strategy list's bordered tile rows, with a
        // Name / Section column header band.
        <div className="flex-1 overflow-auto px-2 pb-2 pt-2">
          <div className="grid grid-cols-[1fr_120px] gap-3 px-4 py-2 text-[11px] tracking-wide text-muted-foreground/70 font-medium sticky top-0 bg-card z-10">
            <span>Name</span>
            <span className="text-right">Section</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {folders.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onOpenFolder(f.id)}
                className="w-full grid grid-cols-[1fr_120px] gap-3 px-4 py-3.5 min-h-[3.25rem] bg-transparent hover:bg-muted/30 border border-border rounded-lg transition-colors items-center text-left"
                title={f.name}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Notebook size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-[13px] font-semibold text-foreground/95 truncate">{f.name}</span>
                </div>
                <span className="text-[12px] text-muted-foreground tabular-nums text-right">
                  {sectionCounts[f.id] ?? 0}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
