'use client';

import { useEffect, useRef, useState } from 'react';
import { GripVertical } from 'lucide-react';
import { ObjectIcon } from '@/components/icons';

// Local atom marker — used in the @-menu's Element option
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
  /** Optional Object submit handler. When provided, typing "@" inside the
   *  textarea opens a popup that lets the user pick Element vs Object. */
  onSubmitObject?: (text: string) => void | Promise<void>;
  /** Placeholder text for the row. Default: "Add @" — the @ hints that the
   *  user can type @ to open the type-selector menu. */
  placeholder?: string;
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
  placeholder = 'Add @',
  colSpan,
  isLoading,
  gutterCount = 2,
}: InlineAddRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [type, setType] = useState<'element' | 'object'>('element');
  const [menuOpen, setMenuOpen] = useState(false);
  const lineCount = text ? text.split('\n').filter(Boolean).length : 0;
  const effectiveColSpan = colSpan - gutterCount;
  const typeSelectable = !!onSubmitObject;

  // Reset internal state when the row deactivates so the next activation
  // starts fresh.
  useEffect(() => {
    if (!active) { setType('element'); setMenuOpen(false); }
  }, [active]);

  // Scroll into view when activated
  useEffect(() => {
    if (active) {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [active]);

  if (!active) {
    return (
      <tr
        ref={rowRef}
        className="group hover:bg-muted/30 cursor-pointer transition-colors tracking-[-0.3px] leading-[1.4]"
        onClick={onActivate}
      >
        {/* Empty gutter cells in inactive state — no drag dots / checkbox shown */}
        {gutterCount >= 1 && <td className="w-8 px-1 py-2"></td>}
        {gutterCount >= 2 && <td className="w-7 px-1 py-2"></td>}
        <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
          <div className="flex items-center gap-1.5 min-w-0 leading-normal">
            <div className="w-3 shrink-0" />
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

  const pickType = (t: 'element' | 'object') => {
    setType(t);
    setMenuOpen(false);
    // Drop the trailing "@" that opened the menu
    if (text.endsWith('@')) setText(text.slice(0, -1));
    // Refocus the textarea after the click steals focus
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleTextChange = (next: string) => {
    setText(next);
    if (typeSelectable && next.endsWith('@') && (next.length === 1 || /\s/.test(next.charAt(next.length - 2)))) {
      // Open the menu when @ is typed at the start or after whitespace
      setMenuOpen(true);
    } else {
      setMenuOpen(false);
    }
  };

  return (
    <tr ref={rowRef} className="tracking-[-0.3px] leading-[1.4]">
      {/* Drag handle gutter — placeholder dots so the user sees where the
           drag affordance will live once the row is saved. */}
      {gutterCount >= 1 && (
        <td className="w-8 px-1 py-2">
          <div className="flex items-center justify-center text-muted-foreground/30">
            <GripVertical size={12} />
          </div>
        </td>
      )}
      {/* Checkbox gutter — placeholder square */}
      {gutterCount >= 2 && (
        <td className="w-7 px-1 py-2">
          <div className="flex items-center justify-center">
            <div className="w-4 h-4 rounded-[2px] border border-muted-foreground/25" />
          </div>
        </td>
      )}
      <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2 relative">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-3 shrink-0" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
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
                if (e.nativeEvent.isComposing) return;
                if (menuOpen && (e.key === 'Escape' || e.key === 'Backspace')) {
                  setMenuOpen(false);
                  if (e.key === 'Escape') e.preventDefault();
                  return;
                }
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
            {/* Active type indicator — small badge after type was picked */}
            {typeSelectable && type === 'object' && !menuOpen && (
              <span className="text-[10px] text-muted-foreground/70 -mt-1">
                Adding as <span className="text-foreground font-medium">Object</span>
              </span>
            )}
          </div>
        </div>

        {/* @-menu — appears anchored under the textarea when "@" is typed */}
        {menuOpen && typeSelectable && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-10 top-full mt-1 z-50 w-44 bg-popover border border-border rounded-lg shadow-lg py-1">
              <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Add as
              </div>
              <button
                type="button"
                onClick={() => pickType('element')}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left text-foreground hover:bg-accent transition-colors"
              >
                <span className="size-4 flex items-center justify-center text-muted-foreground/80"><AtomMarker size={13} /></span>
                Element
              </button>
              <button
                type="button"
                onClick={() => pickType('object')}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-[13px] text-left text-foreground hover:bg-accent transition-colors"
              >
                <span className="size-4 flex items-center justify-center text-muted-foreground/80"><ObjectIcon size={13} /></span>
                Object
              </button>
            </div>
          </>
        )}
      </td>
    </tr>
  );
}
