'use client';

import { useExplorerData } from '@/Function/shared/ExplorerDataContext';

import { useCallback, useMemo, useRef, useState } from 'react';
import { FileDown, PanelLeft } from '@/ui/icons';
import { useDomains } from '@/hooks/useSupabase';
import {
  NoteEditor,
  type NoteEditorHandle,
  type BulletContextInfo,
} from '@/Function/notebook/editor/NoteEditor';
import { BulletExtractDialog } from './BulletExtractDialog';
import { useI18n, translate } from '@/Function/i18n/I18nProvider';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DOCX_MIME, writeDocx } from '@/Function/office/docxWriter';
import { downloadBytes } from '@/Function/office/downloadFile';
import { PresenceStack } from '@/Function/shared/PresenceStack';
import { useNotePresence } from '@/hooks/usePresence';

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
// sidebar/tree keep their own "Untitled" fallback for display. New pages are
// named in the viewer's language, so its "Untitled" counts too.
const isPlaceholderTitle = (title: string) => title === '' || title === 'Untitled' || title === translate('Untitled');

export function PageView({
  fileId,
  title,
  icon,
  content,
  linkedObjectId,
  onTitleChange,
  onContentChange,
  activeDomainId,
  onElementsCreated,
  filesPaneOpen,
  onToggleFilesPane,
}: PageViewProps) {
  const { t } = useI18n();
  const explorerData = useExplorerData();
  // onObjectize / objectizing / onLinkedObjectChange are still on the props
  // (the host keeps wiring them) but currently have no UI trigger — the
  // header strip that exposed Obj化 / Note↔Object link was removed. Left in
  // place so re-adding an entry point is a one-liner.
  const [draftTitle, setDraftTitle] = useState(
    isPlaceholderTitle(title.trim()) ? '' : title,
  );
  const [bulletCtx, setBulletCtx] = useState<BulletContextInfo | null>(null);
  const editorRef = useRef<NoteEditorHandle | null>(null);

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
    for (const o of explorerData?.objects ?? []) {
      for (const e of o.elements ?? []) map[e.id] = e.status;
    }
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

  // Others with this page open (anyone who can see what it is attached to).
  const viewers = useNotePresence(fileId);

  const handleBulletContextMenu = useCallback((info: BulletContextInfo) => {
    setBulletCtx(info);
  }, []);

  return (
    <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden bg-[var(--card)]">
      {/* No bar over the page: its few controls sit in the corners. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-11 [&>*]:pointer-events-auto">
        {onToggleFilesPane && (
          <div className="absolute left-2 top-2">
            {/* The same mark and weight as the title row's sidebar button. */}
            <button type="button" onClick={onToggleFilesPane} aria-pressed={filesPaneOpen}
              title={filesPaneOpen ? t('Hide page list') : t('Show page list')}
              aria-label={filesPaneOpen ? t('Hide page list') : t('Show page list')}
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              <PanelLeft size={15} />
            </button>
          </div>
        )}
        <div className="absolute right-2 top-2 flex items-center gap-2">
          <PresenceStack viewers={viewers} />
          <ButtonAppearanceProvider appearance="navigation">
            <Button variant="ghost" size="icon-sm" title={t('Export to Word')} aria-label={t('Export to Word')}
              onClick={() => { const name = draftTitle.trim() || title || t('Untitled'); void writeDocx(content, name).then((bytes) => downloadBytes(bytes, `${name}.docx`, DOCX_MIME)); }}>
              <FileDown size={16} />
            </Button>
          </ButtonAppearanceProvider>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-8 pt-16 pb-24">
          {icon && (
            <div className="text-5xl mb-3 leading-none select-none">{icon}</div>
          )}
          {/* The title stands on spacing alone — no rule under it. */}
          <div className="mb-6">
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
              placeholder={t('Document title')}
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
            collab={fileId}
            value={content}
            onChange={onContentChange}
            onBulletContextMenu={handleBulletContextMenu}
            elementStatusById={elementStatusById}
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
