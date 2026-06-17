'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Type as TypeIcon,
  Table as TableIcon,
  Link2 as LinkIcon,
  Check as CheckIcon,
} from 'lucide-react';
import { AtomIcon } from '@/alcon/shared/AtomIcon';
import { ObjectIcon } from '@/shell/icons';
import { useDomains } from '@/hooks/useSupabase';
import type { ExplorerData } from '@/hooks/useSupabase';
import {
  AppleNoteEditor,
  type AppleNoteEditorHandle,
  type BulletContextInfo,
} from '@/alcon/brief/editor/AppleNoteEditor';
import { BulletExtractDialog } from './BulletExtractDialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/ui/dropdown-menu';

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
  onLinkedObjectChange,
  onTitleChange,
  onContentChange,
  onObjectize,
  objectizing = false,
  activeDomainId,
  explorerData,
  onElementsCreated,
}: PageViewProps) {
  const [draftTitle, setDraftTitle] = useState(
    PLACEHOLDER_TITLES.has(title.trim()) ? '' : title,
  );
  const [bulletCtx, setBulletCtx] = useState<BulletContextInfo | null>(null);
  const editorRef = useRef<AppleNoteEditorHandle | null>(null);

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
      {/* Apple-Notes-style header strip: small bordered icon buttons.
          Aa opens the style picker; Checklist / Table / Link sit beside
          it. The Obj化 button replaced the old Brief flow — same slot,
          turns the Note into a draft Object + Elements via AI. */}
      <div className="shrink-0 px-4 py-2 flex items-center justify-end gap-1.5 border-b border-border/30">
        <StylePicker onSelect={(action) => {
          // Block actions
          if (action.kind === 'block') editorRef.current?.applyBlock(action.tag);
          else if (action.kind === 'list') editorRef.current?.applyList(action.list);
        }} />
        <HeaderIconBtn
          title="Checklist"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.applyList('check')}
        >
          <AtomIcon size={14} />
        </HeaderIconBtn>
        <HeaderIconBtn
          title="Table"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editorRef.current?.insertTable(3, 3)}
        >
          <TableIcon size={14} />
        </HeaderIconBtn>
        <LinkPicker
          objects={allObjects.map((o) => ({ id: o.id, name: o.name }))}
          linkedObjectId={linkedObjectId ?? null}
          linkedObjectName={linkedObject?.name ?? null}
          onChange={(id) => onLinkedObjectChange?.(id)}
        />
        <HeaderIconBtn
          title={objectizing ? '生成中…' : 'このNoteから Object + Elements を起草する'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onObjectize}
          disabled={objectizing}
        >
          {objectizing ? <SpinnerIcon /> : <ObjectizeIcon />}
        </HeaderIconBtn>
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
            placeholder="Document title"
            className="w-full bg-transparent border-0 no-focus-ring p-0 text-4xl font-bold text-foreground tracking-[-0.5px] leading-[1.15] mb-6 placeholder:text-muted-foreground/50 transition-none"
          />

          <AppleNoteEditor
            ref={editorRef}
            initialHtml={content}
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

// ──────────────────────────────────────────────────────────────────
// Aa style picker — matches the Apple Notes "Aa" terminal button.
// Opens a rounded popover with Title / Heading / Subheading / Body /
// Monostyled / Bulleted / Dashed / Numbered / Block Quote.
// ──────────────────────────────────────────────────────────────────
type StyleAction =
  | { kind: 'block'; tag: 'P' | 'H1' | 'H2' | 'H3' | 'BLOCKQUOTE' | 'PRE' }
  | { kind: 'list'; list: 'bullet' | 'dashed' | 'numbered' };

function StylePicker({ onSelect }: { onSelect: (a: StyleAction) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title="Style"
          className={HEADER_BTN_CLASS}
          // preventDefault on mousedown keeps the editor selection alive
          // so applyBlock / applyList actually have a target.
          onMouseDown={(e) => e.preventDefault()}
        >
          <TypeIcon size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl min-w-[200px] p-1">
        <StyleItem onSelect={() => onSelect({ kind: 'block', tag: 'H1' })} className="text-[15px] font-bold">
          Title
        </StyleItem>
        <StyleItem onSelect={() => onSelect({ kind: 'block', tag: 'H2' })} className="text-[14px] font-semibold">
          Heading
        </StyleItem>
        <StyleItem onSelect={() => onSelect({ kind: 'block', tag: 'H3' })} className="text-[13px] font-semibold">
          Subheading
        </StyleItem>
        <StyleItem onSelect={() => onSelect({ kind: 'block', tag: 'P' })} className="text-[13px]">
          Body
        </StyleItem>
        <StyleItem onSelect={() => onSelect({ kind: 'block', tag: 'PRE' })} className="text-[13px] font-mono">
          Monostyled
        </StyleItem>
        <DropdownMenuSeparator />
        <StyleItem onSelect={() => onSelect({ kind: 'list', list: 'bullet' })} className="text-[13px]">
          <span className="mr-2">•</span> Bulleted List
        </StyleItem>
        <StyleItem onSelect={() => onSelect({ kind: 'list', list: 'dashed' })} className="text-[13px]">
          <span className="mr-2">—</span> Dashed List
        </StyleItem>
        <StyleItem onSelect={() => onSelect({ kind: 'list', list: 'numbered' })} className="text-[13px]">
          <span className="mr-2">1.</span> Numbered List
        </StyleItem>
        <DropdownMenuSeparator />
        <StyleItem onSelect={() => onSelect({ kind: 'block', tag: 'BLOCKQUOTE' })} className="text-[13px] text-muted-foreground">
          <span className="mr-2">|</span> Block Quote
        </StyleItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StyleItem({
  onSelect,
  className,
  children,
}: {
  onSelect: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem
      onSelect={(e) => { e.preventDefault(); onSelect(); }}
      className={`rounded-md ${className ?? ''}`}
    >
      {children}
    </DropdownMenuItem>
  );
}

// Shared header button style. Mirrors the small-bordered "All" / view-
// switcher buttons used in DomainView so the Note header strip reads
// as the same UI vocabulary across the app.
const HEADER_BTN_CLASS =
  'inline-flex items-center justify-center w-7 h-7 text-foreground/70 hover:text-foreground border border-border/60 hover:bg-muted rounded-md transition-colors data-[state=open]:bg-muted data-[state=open]:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground/70';

function HeaderIconBtn({
  title,
  onClick,
  onMouseDown,
  disabled,
  children,
}: {
  title: string;
  onClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      className={HEADER_BTN_CLASS}
    >
      {children}
    </button>
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

// ──────────────────────────────────────────────────────────────────
// Note ↔ Object link picker. The chain icon flips to filled when the
// Note is bound to an Object so the user can tell at a glance which
// Notes are wired into the workspace. Picking an Object writes the
// link to the DB via setLinkedObject (MainContent → useNotes).
// ──────────────────────────────────────────────────────────────────
function LinkPicker({
  objects,
  linkedObjectId,
  linkedObjectName,
  onChange,
}: {
  objects: { id: string; name: string }[];
  linkedObjectId: string | null;
  linkedObjectName: string | null;
  onChange: (id: string | null) => void;
}) {
  const linked = linkedObjectId !== null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={linked && linkedObjectName ? `Linked: ${linkedObjectName}` : 'Link to Object'}
          onMouseDown={(e) => e.preventDefault()}
          className={`${HEADER_BTN_CLASS} ${linked ? 'text-blue-500 hover:text-blue-500 border-blue-500/40 bg-blue-500/5' : ''}`}
        >
          <LinkIcon size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="rounded-xl min-w-[220px] p-1">
        <DropdownMenuLabel className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Link this Note to…
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => { e.preventDefault(); onChange(null); }}
          className="rounded-md gap-2 text-[13px]"
        >
          <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">
            {!linked && <CheckIcon size={12} />}
          </span>
          <span className="text-muted-foreground">No link</span>
        </DropdownMenuItem>
        {objects.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted-foreground/70">
            No Objects yet
          </div>
        ) : (
          <>
            <DropdownMenuSeparator />
            {objects.map((o) => {
              const sel = o.id === linkedObjectId;
              return (
                <DropdownMenuItem
                  key={o.id}
                  onSelect={(e) => { e.preventDefault(); onChange(o.id); }}
                  className="rounded-md gap-2 text-[13px]"
                >
                  <span className="w-4 h-4 inline-flex items-center justify-center text-muted-foreground">
                    {sel && <CheckIcon size={12} />}
                  </span>
                  <ObjectIcon size={12} />
                  <span className="flex-1 truncate">{o.name}</span>
                </DropdownMenuItem>
              );
            })}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
