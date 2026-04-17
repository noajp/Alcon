'use client';

import { Plus } from 'lucide-react';

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
}

/**
 * Asana-style inline "Add element/object" row.
 * - Renders as a subtle "+ Add ..." placeholder until clicked
 * - Activated: becomes a textarea (auto-grow on multi-line)
 * - Enter on single line → submit one
 * - ⌘Enter / Ctrl+Enter on multi-line → submit all (bulk)
 * - Esc → cancel
 * - Stays focused after submit so you can keep adding
 */
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
}: InlineAddRowProps) {
  const lineCount = text ? text.split('\n').filter(Boolean).length : 0;

  if (!active) {
    return (
      <tr
        className="group hover:bg-muted/20 cursor-text transition-colors border-b border-border/60"
        onClick={onActivate}
      >
        <td colSpan={colSpan} className="px-3 py-2">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
            <Plus size={12} />
            <span>{placeholder}</span>
          </div>
        </td>
      </tr>
    );
  }

  const isMultiline = text.includes('\n');

  return (
    <tr className="border-b border-border/60 bg-muted/10">
      <td colSpan={colSpan} className="px-3 py-2">
        <div className="flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (isMultiline) {
                  // multi-line mode: only submit on ⌘/Ctrl+Enter
                  if (e.metaKey || e.ctrlKey) {
                    e.preventDefault();
                    onSubmit(text);
                  }
                } else if (!e.shiftKey) {
                  // single-line mode: Enter submits, Shift+Enter for newline
                  e.preventDefault();
                  onSubmit(text);
                }
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            rows={Math.max(1, Math.min(8, text.split('\n').length))}
            placeholder={placeholder}
            autoFocus
            disabled={isLoading}
            className="w-full text-[13px] bg-transparent border-0 focus:outline-none resize-none placeholder:text-muted-foreground/50 leading-relaxed"
          />
          {(isMultiline || lineCount > 1) && (
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {lineCount > 0 && (
                  <>
                    <span className="font-medium text-foreground tabular-nums">{lineCount}</span> ready · ⌘Enter to add all
                  </>
                )}
              </span>
              <button
                onClick={onCancel}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Esc to cancel
              </button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
