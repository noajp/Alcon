'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { ObjectIcon } from '@/components/icons';

// Local atom marker — small enough to live alongside the Element/Object toggle
function AtomMarker({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.5" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9.5" ry="3.5" transform="rotate(120 12 12)" />
    </svg>
  );
}

interface InlineAddRowProps {
  active: boolean;
  text: string;
  setText: (s: string) => void;
  onActivate: () => void;
  onCancel: () => void;
  onSubmit: (text: string) => void | Promise<void>;
  /** Optional Object submit handler. When provided, the row exposes an
   *  Element / Object type selector and dispatches to the matching handler. */
  onSubmitObject?: (text: string) => void | Promise<void>;
  /** Placeholder used when adding an Element (default mode). */
  placeholder: string;
  /** Placeholder used when the type selector is set to Object. */
  objectPlaceholder?: string;
  colSpan: number;
  isLoading?: boolean;
  /** Number of empty leading cells to render before the input cell.
   *  Default 2 (drag handle + done checkbox). Set 1 for tables that
   *  only have a single gutter, 0 for no gutter. */
  gutterCount?: number;
}

export function InlineAddRow({
  active,
  text,
  setText,
  onActivate,
  onCancel,
  onSubmit,
  onSubmitObject,
  placeholder,
  objectPlaceholder = 'Object name...',
  colSpan,
  isLoading,
  gutterCount = 2,
}: InlineAddRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [type, setType] = useState<'element' | 'object'>('element');
  const lineCount = text ? text.split('\n').filter(Boolean).length : 0;
  const effectiveColSpan = colSpan - gutterCount;
  const typeSelectable = !!onSubmitObject;
  const currentPlaceholder = type === 'object' ? objectPlaceholder : placeholder;

  // Reset to element mode when the row deactivates so the next activation
  // starts fresh (we don't want a stale "object" mode bleed across sessions).
  useEffect(() => {
    if (!active) setType('element');
  }, [active]);

  // Scroll into view when activated (e.g. from "Add New → Element" dropdown)
  useEffect(() => {
    if (active) {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [active]);

  const gutterCells = (
    <>
      {gutterCount >= 1 && (
        <td className="w-8 px-1 py-2">
          <div className="flex items-center justify-center">
            <div className="w-3 h-3 shrink-0" />
          </div>
        </td>
      )}
      {gutterCount >= 2 && <td className="w-7 px-1 py-2"></td>}
    </>
  );

  if (!active) {
    return (
      <tr
        ref={rowRef}
        className="group hover:bg-muted/30 cursor-pointer transition-colors tracking-[-0.3px] leading-[1.4]"
        onClick={onActivate}
      >
        {gutterCells}
        <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
          <div className="flex items-center gap-1.5 min-w-0 leading-normal">
            <div className="w-3 shrink-0" />
            <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/70 group-hover:text-foreground transition-colors">
              <Plus size={13} strokeWidth={2} />
            </span>
            <span className="text-[13px] font-medium truncate text-muted-foreground/80 group-hover:text-foreground transition-colors">
              {placeholder}
            </span>
          </div>
        </td>
      </tr>
    );
  }

  const isMultiline = text.includes('\n');

  const flushAndClear = () => {
    const snapshot = text;
    if (!snapshot.trim()) return;
    setText('');
    if (type === 'object' && onSubmitObject) {
      onSubmitObject(snapshot);
    } else {
      onSubmit(snapshot);
    }
  };

  return (
    <tr ref={rowRef} className="tracking-[-0.3px] leading-[1.4]">
      {gutterCells}
      <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-3 shrink-0" />
          {typeSelectable ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setType((t) => (t === 'element' ? 'object' : 'element')); }}
              className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              title={type === 'element' ? 'Element として追加 (クリックで Object に切替)' : 'Object として追加 (クリックで Element に切替)'}
            >
              {type === 'object' ? <ObjectIcon size={13} /> : <AtomMarker size={13} />}
            </button>
          ) : (
            <div className="size-3.5 shrink-0" />
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (pasted.includes('\n')) {
                  e.preventDefault();
                  const combined = (text + pasted).trim();
                  if (combined) {
                    setText('');
                    if (type === 'object' && onSubmitObject) onSubmitObject(combined);
                    else onSubmit(combined);
                  }
                }
              }}
              onKeyDown={(e) => {
                // Ignore events fired during IME composition (Japanese/Chinese/Korean input)
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter') {
                  if (isMultiline) {
                    if (e.metaKey || e.ctrlKey) { e.preventDefault(); flushAndClear(); }
                  } else if (!e.shiftKey) {
                    e.preventDefault();
                    flushAndClear();
                  }
                }
                if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
              }}
              rows={Math.max(1, Math.min(8, text.split('\n').length))}
              placeholder={currentPlaceholder}
              autoFocus
              style={{ padding: 0, margin: 0, border: 0, textIndent: 0, boxSizing: 'border-box' }}
              className="no-focus-ring w-full text-[13px] leading-[1.4] bg-transparent outline-none focus:outline-none focus-visible:outline-none focus:ring-0 resize-none text-foreground placeholder:text-muted-foreground/60 [&:placeholder-shown]:text-muted-foreground/60"
            />
            {isMultiline && lineCount > 1 && (
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground tabular-nums">{lineCount}</span> lines · ⌘Enter to add all
                </span>
                <button onClick={onCancel} className="text-muted-foreground hover:text-foreground transition-colors">
                  Esc to cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}
