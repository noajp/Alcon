'use client';

import { useCallback, useId, useState } from 'react';
import { BlockEditor } from '@/alcon/brief/editor/BlockEditor';

interface PageViewProps {
  fileId: string;
  title: string;
  icon?: string;
  content: string;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onBrief: () => void;
}

// Caller should mount this with key={fileId} so the BlockEditor remounts
// (and re-initializes) when switching between pages.
export function PageView({
  title,
  icon,
  content,
  onTitleChange,
  onContentChange,
  onBrief,
}: PageViewProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const rawId = useId();
  // useId returns ":r1:"-style values that aren't valid CSS/DOM ids in all
  // contexts; sanitize to keep it safe for document.getElementById.
  const toolbarContainerId = `page-toolbar-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const commitTitle = useCallback(() => {
    const next = draftTitle.trim();
    if (next && next !== title) onTitleChange(next);
    else setDraftTitle(title);
  }, [draftTitle, title, onTitleChange]);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--card)]">
      {/* Top toolbar (OneNote-style ribbon) + page actions */}
      <div className="shrink-0 border-b border-border bg-background/40 pl-3 pr-2 min-h-[44px] flex items-center gap-2">
        <div id={toolbarContainerId} className="flex-1 min-w-0 flex items-center overflow-x-auto" />
        <button
          type="button"
          onClick={onBrief}
          className="shrink-0 inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 border border-border rounded-md hover:border-foreground/40 hover:bg-accent text-foreground/80 hover:text-foreground"
          title="このNoteを Brief として確定する"
        >
          <BriefIcon />
          Brief
        </button>
      </div>

      {/* Page scroll area */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-12 pt-16 pb-24">
          {icon && (
            <div className="text-5xl mb-3 leading-none select-none">{icon}</div>
          )}
          <input
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="Untitled"
            className="w-full bg-transparent border-0 no-focus-ring p-0 text-4xl font-bold text-foreground tracking-[-0.5px] leading-[1.15] mb-6 placeholder:text-foreground/25 transition-none"
          />

          <BlockEditor
            initialContent={content}
            onChange={onContentChange}
            toolbarContainerId={toolbarContainerId}
          />
        </div>
      </div>
    </div>
  );
}

function BriefIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="4" width="13" height="16" rx="1.5" />
      <rect x="7" y="6" width="13" height="16" rx="1.5" fill="currentColor" fillOpacity="0.08" />
      <circle cx="9.5" cy="8.5" r="0.9" fill="currentColor" stroke="none" />
      <line x1="12" y1="11.5" x2="18" y2="11.5" />
      <line x1="12" y1="14" x2="17" y2="14" />
    </svg>
  );
}
