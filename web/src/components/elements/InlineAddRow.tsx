'use client';

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
  /** When true, render an empty leading cell so the "Add..." aligns with the title column (after the gutter). */
  indent?: boolean;
}

/**
 * Asana-style inline "Add element/object" row.
 * - Renders as a subtle "Add ..." placeholder until clicked
 * - Activated: becomes a textarea (auto-grow on multi-line)
 * - Enter on single line → submit one
 * - ⌘Enter / Ctrl+Enter on multi-line → submit all (bulk)
 * - Esc → cancel
 * - Stays focused after submit so you can keep adding
 *
 * Layout matches the element table row exactly: same gutter dimensions
 * (with a placeholder div so the table layout doesn't collapse the empty
 * cell), then a w-4 + size-3.5 + gap-2 chain in the content cell so the
 * leading character lines up with the element title column.
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
  indent = true,
}: InlineAddRowProps) {
  const lineCount = text ? text.split('\n').filter(Boolean).length : 0;
  const effectiveColSpan = indent ? colSpan - 1 : colSpan;

  // Same dimensions as the element row's drag-handle gutter so the table
  // doesn't auto-shrink this cell and the title column lines up.
  const gutterCell = (
    <td className="w-8 px-1 py-2">
      <div className="flex items-center justify-center">
        <div className="w-3 h-3 shrink-0" />
      </div>
    </td>
  );

  if (!active) {
    return (
      <tr
        className="group hover:bg-muted/20 cursor-text transition-colors border-b border-border/60"
        onClick={onActivate}
      >
        {indent && gutterCell}
        <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground/60 group-hover:text-muted-foreground transition-colors min-w-0 leading-normal">
            <div className="w-4 shrink-0" />
            <div className="size-3.5 shrink-0" />
            <span className="truncate">{placeholder}</span>
          </div>
        </td>
      </tr>
    );
  }

  const isMultiline = text.includes('\n');

  // Submit current text and clear input synchronously (optimistic UX)
  const flushAndClear = () => {
    const snapshot = text;
    if (!snapshot.trim()) return;
    setText(''); // clear immediately so user can keep typing
    // Fire-and-forget — onSubmit handles async DB writes + refresh
    onSubmit(snapshot);
  };

  return (
    <tr className="border-b border-border/60">
      {indent && gutterCell}
      <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-4 shrink-0" />
          <div className="size-3.5 shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                // If pasted content contains newlines → submit immediately, no Enter needed.
                // Single-line paste falls through to normal paste behavior.
                const pasted = e.clipboardData.getData('text');
                if (pasted.includes('\n')) {
                  e.preventDefault();
                  // Combine any existing text with the pasted content
                  const combined = (text + pasted).trim();
                  if (combined) {
                    setText('');
                    onSubmit(combined);
                  }
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (isMultiline) {
                    // multi-line mode (typed manually): submit on ⌘/Ctrl+Enter
                    if (e.metaKey || e.ctrlKey) {
                      e.preventDefault();
                      flushAndClear();
                    }
                  } else if (!e.shiftKey) {
                    // single-line: Enter submits, Shift+Enter for newline
                    e.preventDefault();
                    flushAndClear();
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
              // text-sm + leading-normal = exact same metrics as the inactive
              // <span> placeholder, so the row height does not jump on click.
              // Explicit text + placeholder color (both muted-foreground/60)
              // so the click does not flash a darker color before the user
              // starts typing. Once they type, text becomes foreground.
              //
              // Inline style zeros out every browser-default form-element gap
              // (padding, margin, text-indent, border) — Tailwind's preflight
              // sets some, but Chromium still reserves a 1–2px caret gutter
              // unless we override here. That gutter was the residual ~2px
              // misalignment between this row and element titles.
              style={{ padding: 0, margin: 0, border: 0, textIndent: 0, boxSizing: 'border-box' }}
              className="no-focus-ring w-full text-sm leading-normal bg-transparent outline-none focus:outline-none focus-visible:outline-none focus:ring-0 resize-none text-foreground placeholder:text-muted-foreground/60 [&:placeholder-shown]:text-muted-foreground/60"
            />
            {isMultiline && lineCount > 1 && (
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground tabular-nums">{lineCount}</span> lines · ⌘Enter to add all
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
        </div>
      </td>
    </tr>
  );
}
