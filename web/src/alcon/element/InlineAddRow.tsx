'use client';

import { useEffect, useRef } from 'react';

interface InlineAddRowProps {
  active: boolean;
  text: string;
  setText: (s: string) => void;
  onActivate: () => void;
  onCancel: () => void;
  onSubmit: (text: string) => void | Promise<void>;
  placeholder: string;
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
  placeholder,
  colSpan,
  isLoading,
  gutterCount = 2,
}: InlineAddRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const lineCount = text ? text.split('\n').filter(Boolean).length : 0;
  const effectiveColSpan = colSpan - gutterCount;

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
        className="group hover:bg-muted/20 cursor-text transition-colors tracking-[-0.3px] leading-[1.4]"
        onClick={onActivate}
      >
        {gutterCells}
        <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
          <div className="flex items-center gap-1.5 min-w-0 leading-normal">
            <div className="w-3 shrink-0" />
            <div className="size-3.5 shrink-0" />
            <span className="text-[13px] font-medium truncate text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
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
    onSubmit(snapshot);
  };

  return (
    <tr ref={rowRef} className="tracking-[-0.3px] leading-[1.4]">
      {gutterCells}
      <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-3 shrink-0" />
          <div className="size-3.5 shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text');
                if (pasted.includes('\n')) {
                  e.preventDefault();
                  const combined = (text + pasted).trim();
                  if (combined) { setText(''); onSubmit(combined); }
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
              placeholder={placeholder}
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
