'use client';

import { Menu, Plus } from 'lucide-react';
import type { NoteNode } from './types';

// OneNote-style Section list that slides in from the left over the left
// column — starting just below the breadcrumb header (which stays visible),
// covering the FilesPane header + file list — when the FilesPane hamburger is
// toggled. Rendered by MainContent (not FilesPane) so it sits at the notebook
// surface level.
//
// The header has no divider so the list reads as one continuous surface. Each
// row switches Section (single click → closes). Toggling the hamburger again
// slides it away to reveal the file list.
export function SectionDrawer({
  open,
  sections,
  activeSectionId,
  onClose,
  onSelect,
  onAdd,
}: {
  open: boolean;
  sections: NoteNode[];
  activeSectionId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div
      className={`absolute top-[50px] bottom-0 left-0 z-30 w-full sm:w-60 flex flex-col bg-card border-r border-border/40 transition-transform duration-300 ease-out ${
        // No drop shadow — the border-r already delineates the sidebar. A big
        // soft shadow bled onto the editor as a grey "stain" at the boundary.
        open ? 'translate-x-0' : '-translate-x-full pointer-events-none'
      }`}
    >
      {/* Header — add Section on the left, hamburger (close) on the right.
          When the drawer slides in over the FilesPane, the hamburger appears
          to move from the FilesPane header's left to the drawer's right. A
          bottom divider matches the FilesPane header so it reads as a sidebar. */}
      <div className="flex items-center gap-1 h-[50px] px-2 shrink-0 border-b border-border/30">
        <button
          type="button"
          onClick={onAdd}
          title="New Section"
          aria-label="New Section"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
        >
          <Plus size={14} />
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          title="Close Sections"
          aria-label="Close Sections"
          className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-muted text-foreground shrink-0"
        >
          <Menu size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-2">
        {sections.map((s) => {
          const active = s.id === activeSectionId;
          return (
            <div
              key={s.id}
              className={`w-full flex items-center pl-[13px] transition-colors ${
                active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              <button
                type="button"
                onClick={() => { onSelect(s.id); onClose(); }}
                className="min-w-0 flex-1 flex items-center gap-2 pr-3 py-1.5 text-left text-[12px] font-semibold truncate"
                title={s.name}
              >
                <span className="w-[3px] h-4 rounded-full shrink-0 bg-[var(--text-tertiary)]" />
                {s.name}
              </button>
            </div>
          );
        })}
        {sections.length === 0 && (
          <div className="px-3 py-6 text-[11px] text-muted-foreground/60 text-center leading-relaxed">
            No sections yet — click + to add one
          </div>
        )}
      </div>
    </div>
  );
}
