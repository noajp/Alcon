'use client';

import { useCallback, useId, useState } from 'react';
import { BlockEditor } from '@/components/editor/BlockEditor';

interface PageViewProps {
  fileId: string;
  title: string;
  icon?: string;
  content: string;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
}

// Caller should mount this with key={fileId} so the BlockEditor remounts
// (and re-initializes) when switching between pages.
export function PageView({ title, icon, content, onTitleChange, onContentChange }: PageViewProps) {
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
      {/* Top toolbar (OneNote-style ribbon) */}
      <div
        id={toolbarContainerId}
        className="shrink-0 border-b border-border bg-background/40 px-3 min-h-[44px] flex items-center overflow-x-auto"
      />

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
            className="w-full bg-transparent outline-none text-4xl font-bold text-foreground tracking-[-0.5px] mb-6 placeholder:text-foreground/25"
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
