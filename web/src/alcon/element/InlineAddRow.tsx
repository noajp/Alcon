'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ObjectIcon } from '@/shell/icons';

// The list table freezes its leading cells (the gutters + Name) so they stay
// put while the data columns scroll horizontally. This row lives in that same
// table, so its cells carry the same sticky offsets and the same opaque
// background — otherwise the input would slide out from under the names it
// lines up with. Indexed by cell position; the Name cell's index equals the
// number of gutters in front of it.
const STICKY_CELL = [
  'sticky left-0 z-10 bg-card',
  'sticky left-7 z-10 bg-card',
  'sticky left-14 z-10 bg-card',
];
// Chrome for the closed (ghost) row: the same hover pill the Element rows
// draw, starting on the second cell. Those rows tint with a translucent
// foreground/6% wash, which sticky cells can't use (the columns sliding
// underneath would show through), so this is the opaque equivalent.
const GHOST_ROW_CHROME =
  'group cursor-pointer leading-[1.4] [&>td]:transition-colors [&>td:nth-child(2)]:rounded-l-lg [&>td:nth-last-child(2)]:rounded-r-lg [&:hover>td.sticky:not(:first-child)]:bg-[color-mix(in_oklab,var(--foreground)_6%,var(--card))]';

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
  /** Create from the typed title. Awaited, so the text stays on screen until
   *  the new row lands; the row then clears itself and stays open for the
   *  next title. Newlines mean a multi-line paste — one item per line. */
  onSubmit: (text: string) => void | Promise<void>;
  /** Optional Object submit handler. When provided, typing "@" inside the
   *  input opens a popup that lets the user pick Element vs Object. */
  onSubmitObject?: (text: string) => void | Promise<void>;
  /** Placeholder text for the row. Default: "Add @" — the @ hints that the
   *  user can type @ to open the type-selector menu. Rows with a lockedType
   *  have no menu, so they should pass a plain label instead. */
  placeholder?: string;
  /** Total cells in the table's row, gutters included. */
  colSpan: number;
  isLoading?: boolean;
  /** Number of empty leading cells to render before the input cell. Default 2
   *  — the list table's checkbox and priority gutters, both 28px wide, which
   *  is what the sticky offsets assume. Set 1 for tables with a single
   *  gutter, 0 for none. */
  gutterCount?: number;
  /** Lock the row to a specific add type. When set, the @-menu is suppressed
   *  and submission always routes to the locked type's handler. The icon
   *  marker reflects the locked type. */
  lockedType?: 'element' | 'object';
}

/**
 * Split a submitted title back into one title per line — the counterpart to
 * the row's multi-line paste, which hands the whole clipboard over in a single
 * submit. Single-line input comes back as a one-entry array, so callers can
 * run every submit through this without branching.
 */
export function parseInlineTitles(raw: string): string[] {
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}

type AddType = 'element' | 'object';
const MENU_OPTIONS: { type: AddType; label: string; Icon: React.FC<{ size?: number }> }[] = [
  { type: 'element', label: 'Element', Icon: ({ size }) => <AtomMarker size={size} /> },
  { type: 'object', label: 'Object', Icon: ({ size }) => <ObjectIcon size={size} /> },
];

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
  lockedType,
}: InlineAddRowProps) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Submit-in-flight guard so a second Enter while the first is still in
  // flight doesn't double-submit. Cleared in `finally`.
  const submittingRef = useRef(false);
  // Track the latest text via a ref so flushAndClear's async tail can check
  // whether the user has started typing the next item before auto-clearing.
  const textRef = useRef(text);
  textRef.current = text;
  // The user's @-menu pick (separate from the lock). When the row is locked,
  // the lock wins; otherwise this drives the icon and submit handler. Keeping
  // these as derived values (not synced via useEffect) means the displayed
  // icon never lags a render behind the prop or has stale state from
  // component reuse.
  const [pickedType, setPickedType] = useState<AddType | null>(null);
  const type: AddType = lockedType ?? pickedType ?? 'element';
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const effectiveColSpan = colSpan - gutterCount;
  // Locked rows never expose the @-menu — the parent decides which type
  // belongs in this section, so there's nothing for the user to pick.
  const typeSelectable = !!onSubmitObject && !lockedType;

  // Reset the user's pick + menu state when the row deactivates so the next
  // activation starts fresh. The lock keeps winning regardless.
  useEffect(() => {
    if (!active) {
      setPickedType(null);
      setMenuOpen(false);
      setMenuIndex(0);
    }
  }, [active]);

  // Scroll into view when activated
  useEffect(() => {
    if (active) {
      rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [active]);

  // Reposition the @-menu under the input whenever it opens or layout shifts
  useEffect(() => {
    if (!menuOpen) return;
    const update = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect) setMenuPos({ left: rect.left, top: rect.bottom + 4 });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [menuOpen]);

  // Close the menu when the user clicks anywhere outside the input/menu
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current?.contains(target)) return;
      if ((target as HTMLElement)?.closest?.('[data-inline-add-menu]')) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const pickType = (t: AddType) => {
    setPickedType(t);
    setMenuOpen(false);
    // Drop the trailing "@" that opened the menu
    if (text.endsWith('@')) setText(text.slice(0, -1));
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  if (!active) {
    return (
      <tr ref={rowRef} className={GHOST_ROW_CHROME} onClick={onActivate}>
        {/* Empty gutter cells in the closed state — the checkbox and priority
             marks belong to real rows, so nothing is faked here. */}
        {gutterCount >= 1 && <td className={`${STICKY_CELL[0]} w-7 px-1 py-2`} />}
        {gutterCount >= 2 && <td className={`${STICKY_CELL[1]} w-7 px-1 py-2`} />}
        <td colSpan={effectiveColSpan} className={`${STICKY_CELL[gutterCount]} pl-0.5 pr-2 py-2 min-w-0`}>
          {/* Same inner metrics as an Element row's Name cell, so the marker
               and the label sit on the row grid above and below. */}
          <div className="flex items-center gap-2 min-w-0 min-h-[1.625rem]">
            <span className="size-4 shrink-0 flex items-center justify-center text-muted-foreground/60 group-hover:text-foreground/70 transition-colors">
              {type === 'object' ? <ObjectIcon size={14} /> : <AtomMarker size={14} />}
            </span>
            <span className="text-[13px] font-[550] truncate text-muted-foreground/80 group-hover:text-foreground transition-colors">
              {placeholder}
            </span>
          </div>
        </td>
      </tr>
    );
  }

  const flushAndClear = async () => {
    if (submittingRef.current) return;
    const snapshot = text;
    if (!snapshot.trim()) return;
    submittingRef.current = true;
    try {
      // Await the parent's submit so the typed text stays visible in the
      // input until the new row actually appears in the list above.
      // Without this await the input clears immediately and the user sees
      // a brief "blank → list item" flash.
      if (type === 'object' && onSubmitObject) {
        await onSubmitObject(snapshot);
      } else {
        await onSubmit(snapshot);
      }
    } catch (e) {
      console.error('Inline submit failed:', e);
    } finally {
      submittingRef.current = false;
    }
    // Only clear if the user hasn't started typing the next item already.
    if (textRef.current === snapshot) setText('');
  };

  const handleTextChange = (next: string) => {
    setText(next);
    if (typeSelectable && next.endsWith('@')) {
      setMenuOpen(true);
      setMenuIndex(0);
    } else {
      setMenuOpen(false);
    }
  };

  const menu = menuOpen && typeSelectable && typeof window !== 'undefined'
    ? createPortal(
        <div
          data-inline-add-menu
          className="fixed z-[1000] w-52 bg-popover/95 backdrop-blur-sm border border-border rounded-xl shadow-2xl py-1.5 overflow-hidden"
          style={{ left: menuPos.left, top: menuPos.top }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="px-3 py-1 text-[11px] font-medium text-muted-foreground">
            Add as
          </div>
          {MENU_OPTIONS.map((opt, i) => (
            <button
              key={opt.type}
              type="button"
              onMouseEnter={() => setMenuIndex(i)}
              onClick={() => pickType(opt.type)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-left text-foreground transition-colors ${
                menuIndex === i ? 'bg-accent' : ''
              }`}
            >
              <span className="size-4 flex items-center justify-center text-foreground/80"><opt.Icon size={14} /></span>
              <span className="flex-1">{opt.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )
    : null;

  return (
    <tr ref={rowRef} className="leading-[1.4]">
      {gutterCount >= 1 && <td className={`${STICKY_CELL[0]} w-7 px-1 py-2`} />}
      {gutterCount >= 2 && <td className={`${STICKY_CELL[1]} w-7 px-1 py-2`} />}
      <td colSpan={effectiveColSpan} className={`${STICKY_CELL[gutterCount]} pl-0.5 pr-2 py-2 min-w-0`}>
        <div className="flex items-center gap-2 min-w-0 min-h-[1.625rem]">
          {/* Type marker — always rendered so the active row visually matches
               the Element/Object rows it will become. The icon reflects the
               current effective type (lock > user pick > 'element' default). */}
          <span className="size-4 shrink-0 flex items-center justify-center text-foreground/80">
            {type === 'object' ? <ObjectIcon size={14} /> : <AtomMarker size={14} />}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={text}
            placeholder={placeholder}
            onChange={(e) => handleTextChange(e.target.value)}
            onPaste={(e) => {
              // Multi-line paste → split immediately into individual items
              // and submit them in bulk. This is the canonical bulk-add path.
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
              // Menu navigation takes priority over Enter / Escape handling
              if (menuOpen) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMenuIndex((i) => (i + 1) % MENU_OPTIONS.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMenuIndex((i) => (i - 1 + MENU_OPTIONS.length) % MENU_OPTIONS.length);
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  pickType(MENU_OPTIONS[menuIndex].type);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMenuOpen(false);
                  return;
                }
                if (e.key === 'Backspace') {
                  // Closing-handled by handleTextChange after the @ disappears
                  setMenuOpen(false);
                  return;
                }
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                flushAndClear();
                return;
              }
              if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }}
            autoFocus
            style={{ padding: 0, margin: 0, border: 0, textIndent: 0, boxSizing: 'border-box' }}
            // No border / ring / outline: globals.css hands out no focus
            // affordance of its own, and `bg-transparent` opts the field out
            // of the base input border. The row being open IS the affordance.
            className="flex-1 min-w-0 text-[13px] font-[550] leading-[1.4] bg-transparent outline-none text-foreground placeholder:text-muted-foreground/80 placeholder:font-[550]"
          />
        </div>
      </td>
      {menu}
    </tr>
  );
}
