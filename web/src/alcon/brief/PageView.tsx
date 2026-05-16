'use client';

import { useCallback, useState } from 'react';
import { AppleNoteEditor, type BulletContextInfo } from '@/alcon/brief/editor/AppleNoteEditor';
import { BulletExtractDialog } from './BulletExtractDialog';

interface PageViewProps {
  fileId: string;
  title: string;
  icon?: string;
  /** HTML body of the note. */
  content: string;
  onTitleChange: (title: string) => void;
  onContentChange: (html: string) => void;
  /** Open the Object draft dialog (Note → Object + Elements). */
  onObjectize: () => void;
  /** When true, the Object draft pipeline is currently running (AI summarize + draft). */
  objectizing?: boolean;
  /** Active Domain to scope Object selection in the bullet → Element flow. */
  activeDomainId?: string | null;
  /** Notify the host so the explorer can refetch after Elements are created. */
  onElementsCreated?: () => void;
}

// Caller should mount this with key={fileId} so the editor remounts
// (and re-initializes) when switching between pages.
export function PageView({
  title,
  icon,
  content,
  onTitleChange,
  onContentChange,
  onObjectize,
  objectizing = false,
  activeDomainId,
  onElementsCreated,
}: PageViewProps) {
  const [draftTitle, setDraftTitle] = useState(title);
  const [bulletCtx, setBulletCtx] = useState<BulletContextInfo | null>(null);

  const commitTitle = useCallback(() => {
    const next = draftTitle.trim();
    if (next && next !== title) onTitleChange(next);
    else setDraftTitle(title);
  }, [draftTitle, title, onTitleChange]);

  const handleBulletContextMenu = useCallback((info: BulletContextInfo) => {
    setBulletCtx(info);
  }, []);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--card)]">
      {/* Minimal top bar — the Obj化 action turns this Note into a draft Object + Elements. */}
      <div className="shrink-0 px-4 py-2 flex items-center justify-end border-b border-border/30">
        <button
          type="button"
          onClick={onObjectize}
          disabled={objectizing}
          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60 disabled:cursor-wait"
          title="このNoteから Object + Elements を起草する"
        >
          {objectizing ? <SpinnerIcon /> : <ObjectizeIcon />}
          {objectizing ? '生成中…' : 'Obj化'}
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

          <AppleNoteEditor
            initialHtml={content}
            onChange={onContentChange}
            onBulletContextMenu={handleBulletContextMenu}
          />
        </div>
      </div>

      {bulletCtx && (
        <BulletExtractDialog
          texts={bulletCtx.texts}
          anchor={{ x: bulletCtx.x, y: bulletCtx.y }}
          activeDomainId={activeDomainId}
          onClose={() => setBulletCtx(null)}
          onCreated={(count) => {
            console.log(`[bullet-extract] created ${count} Elements`);
            onElementsCreated?.();
          }}
        />
      )}
    </div>
  );
}

function ObjectizeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5z" />
      <circle cx="19" cy="19" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="19" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" strokeDasharray="14 40" strokeLinecap="round" />
    </svg>
  );
}
