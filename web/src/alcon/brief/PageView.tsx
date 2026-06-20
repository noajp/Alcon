'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useDomains } from '@/hooks/useSupabase';
import type { ExplorerData } from '@/hooks/useSupabase';
import {
  NoteEditor,
  type NoteEditorHandle,
  type BulletContextInfo,
} from '@/alcon/brief/editor/NoteEditor';
import { BulletExtractDialog } from './BulletExtractDialog';

interface PageViewProps {
  fileId: string;
  title: string;
  icon?: string;
  /** HTML body of the note. */
  content: string;
  /** Object this Note is linked to. When set, bullet → Element conversion
   *  defaults to this Object (and its Domain). */
  linkedObjectId?: string | null;
  onLinkedObjectChange?: (objectId: string | null) => void;
  onTitleChange: (title: string) => void;
  onContentChange: (html: string) => void;
  /** Open the Object draft dialog (Note → Object + Elements). */
  onObjectize: () => void;
  /** When true, the Object draft pipeline is currently running (AI summarize + draft). */
  objectizing?: boolean;
  /** Active Domain — used as the Object-picker scope fallback when no
   *  link is set yet. */
  activeDomainId?: string | null;
  /** ExplorerData (all Objects across Domains) — drives the link picker
   *  list in the header and resolves linkedObjectId → its Domain. */
  explorerData?: ExplorerData;
  /** Notify the host so the explorer can refetch after Elements are created. */
  onElementsCreated?: () => void;
  /** File-list pane visibility + toggle, surfaced as a header button. */
  filesPaneOpen?: boolean;
  onToggleFilesPane?: () => void;
}

// Caller should mount this with key={fileId} so the editor remounts
// (and re-initializes) when switching between pages.
// Titles we treat as "not really named yet" — the field shows the gray
// "Document title" placeholder for these instead of the literal word, the
// way Notion never surfaces its "Untitled" default as real text. The
// sidebar/tree keep their own "Untitled" fallback for display.
const PLACEHOLDER_TITLES = new Set(['', 'Untitled']);

export function PageView({
  title,
  icon,
  content,
  linkedObjectId,
  onTitleChange,
  onContentChange,
  activeDomainId,
  explorerData,
  onElementsCreated,
  filesPaneOpen,
  onToggleFilesPane,
}: PageViewProps) {
  // onObjectize / objectizing / onLinkedObjectChange are still on the props
  // (the host keeps wiring them) but currently have no UI trigger — the
  // header strip that exposed Obj化 / Note↔Object link was removed. Left in
  // place so re-adding an entry point is a one-liner.
  const [draftTitle, setDraftTitle] = useState(
    PLACEHOLDER_TITLES.has(title.trim()) ? '' : title,
  );
  const [bulletCtx, setBulletCtx] = useState<BulletContextInfo | null>(null);
  const editorRef = useRef<NoteEditorHandle | null>(null);
  const toolbarPortalRef = useRef<HTMLDivElement | null>(null);

  // Elements created from a Note land in the linked Object's Domain (when
  // a link is set) and otherwise fall back to the active Domain. The
  // legacy "default to Individual Domain" branch was dropped when the
  // Individual Domain pattern was removed in favour of the sidebar's
  // "My Elements" entry.
  useDomains(); // keep the cache warm; the result isn't needed here anymore
  const allObjects = explorerData?.objects ?? [];
  const linkedObject = useMemo(() => {
    if (!linkedObjectId) return null;
    return allObjects.find((o) => o.id === linkedObjectId) ?? null;
  }, [linkedObjectId, allObjects]);
  const elementDomainId = linkedObject?.domain_id ?? activeDomainId ?? null;
  const elementDefaultObjectId = linkedObject?.id ?? null;

  // id → status for every Element across all Domains — lets the editor
  // render each linked bullet's ○ as a read-only mirror of its Element.
  const elementStatusById = useMemo<Record<string, string | null | undefined>>(() => {
    const map: Record<string, string | null | undefined> = {};
    const walk = (objs: typeof allObjects) => {
      for (const o of objs) {
        for (const e of o.elements ?? []) map[e.id] = e.status;
        if (o.children) walk(o.children);
      }
    };
    walk(explorerData?.objects ?? []);
    for (const e of explorerData?.rootElements ?? []) map[e.id] = e.status;
    return map;
  }, [explorerData]);

  const commitTitle = useCallback(() => {
    const next = draftTitle.trim();
    if (next && next !== title) onTitleChange(next);
    // Empty (or a placeholder default) → leave the field blank so the
    // "Document title" placeholder stays visible; don't resurrect "Untitled".
    else if (!next) setDraftTitle('');
    else setDraftTitle(title);
  }, [draftTitle, title, onTitleChange]);

  const handleBulletContextMenu = useCallback((info: BulletContextInfo) => {
    setBulletCtx(info);
  }, []);

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--card)]">
      <div className="relative flex items-center justify-center h-[50px] shrink-0 border-b border-border/30">
        {onToggleFilesPane && (
          <button
            type="button"
            onClick={onToggleFilesPane}
            title={filesPaneOpen ? 'Hide file list' : 'Show file list'}
            aria-label={filesPaneOpen ? 'Hide file list' : 'Show file list'}
            className="absolute left-2 inline-flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            {filesPaneOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
        )}
        <div ref={toolbarPortalRef} className="flex items-center justify-center" />
      </div>
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 pt-16 pb-24">
          {icon && (
            <div className="text-5xl mb-3 leading-none select-none">{icon}</div>
          )}
          {/* Thin rule under the title — the border lives on this wrapper,
              not the <input> (project rule: no frames/rings on inputs). */}
          <div className="mb-6 pb-3 border-b border-border/50">
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                // Ignore the Enter that confirms an IME composition — calling
                // preventDefault() on it breaks the commit and the composing
                // text gets duplicated (e.g. "あ" → "ああああ").
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  (e.currentTarget as HTMLInputElement).blur();
                }
              }}
              placeholder="Document title"
              // Box-aligned with the body (both sit at the px-12 content edge,
              // measured pixel-identical). We deliberately do NOT add a
              // negative text-indent to optically compensate the heading's
              // larger left side-bearing: an <input> clips its value at the
              // content edge, so any negative indent shears the first glyph of
              // a Latin title ("A" → cut off). Every major editor box-aligns
              // here and lives with the bearing.
              className="w-full bg-transparent border-0 no-focus-ring p-0 text-4xl font-bold text-foreground tracking-[-0.5px] leading-[1.15] placeholder:text-muted-foreground/50 transition-none"
            />
          </div>

          <NoteEditor
            ref={editorRef}
            initialHtml={content}
            onChange={onContentChange}
            onBulletContextMenu={handleBulletContextMenu}
            elementStatusById={elementStatusById}
            toolbarPortalRef={toolbarPortalRef}
          />
        </div>
      </div>

      {bulletCtx && (
        <BulletExtractDialog
          texts={bulletCtx.texts}
          anchor={{ x: bulletCtx.x, y: bulletCtx.y }}
          activeDomainId={elementDomainId}
          defaultObjectId={elementDefaultObjectId}
          onClose={() => setBulletCtx(null)}
          onCreated={(created) => {
            // Stamp the data-element-id link onto each source bullet so
            // its ○ starts mirroring the new (Backlog) Element.
            if (bulletCtx) {
              const entries = created
                .map((c) => ({ li: bulletCtx.liNodes[c.index], elementId: c.elementId }))
                .filter((e): e is { li: HTMLLIElement; elementId: string } => !!e.li);
              if (entries.length > 0) editorRef.current?.linkBullets(entries);
            }
            onElementsCreated?.();
          }}
        />
      )}
    </div>
  );
}
