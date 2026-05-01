'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
   *  input opens a popup that lets the user pick Element vs Object. */
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
  /** Lock the row to a specific add type. When set, the @-menu is suppressed
   *  and submission always routes to the locked type's handler. The icon
   *  marker reflects the locked type. */
  lockedType?: 'element' | 'object';
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
      <tr
        ref={rowRef}
        className="group hover:bg-muted/30 cursor-pointer transition-colors tracking-[-0.3px] leading-[1.4]"
        onClick={onActivate}
      >
        {/* Empty gutter cells in inactive state — no drag dots / checkbox shown */}
        {gutterCount >= 1 && <td className="w-8 px-1 py-2"></td>}
        {gutterCount >= 2 && <td className="w-7 px-1 py-2"></td>}
        <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
          <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem] leading-normal">
            {/* Match the subelement-expand gutter and icon column of Element/Object
                 rows so the "Add @" text aligns with their names below/above. */}
            <div className="w-3 shrink-0" />
            {lockedType ? (
              <span className="size-3.5 shrink-0 flex items-center justify-center text-muted-foreground/60 group-hover:text-foreground/70 transition-colors">
                {lockedType === 'object' ? <ObjectIcon size={13} /> : <AtomMarker size={13} />}
              </span>
            ) : (
              <div className="size-3.5 shrink-0" />
            )}
            <span className="text-[13px] font-medium truncate text-muted-foreground/80 group-hover:text-foreground transition-colors">
              {placeholder}
            </span>
          </div>
        </td>
      </tr>
    );
  }

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
          <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
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
    <tr ref={rowRef} className="tracking-[-0.3px] leading-[1.4]">
      {/* Drag handle gutter — placeholder dots */}
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
      <td colSpan={effectiveColSpan} className="pl-1 pr-2 py-2">
        <div className="flex items-center gap-1.5 min-w-0 min-h-[1.625rem]">
          <div className="w-3 shrink-0" />
          {/* Type marker — always rendered so the active row visually matches
               the Element/Object rows it will become. The icon reflects the
               current effective type (lock > user pick > 'element' default). */}
          <span className="size-3.5 shrink-0 flex items-center justify-center text-foreground/80">
            {type === 'object' ? <ObjectIcon size={13} /> : <AtomMarker size={13} />}
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
            className="no-focus-ring flex-1 min-w-0 text-[13px] font-medium leading-[1.4] bg-transparent outline-none focus:outline-none focus-visible:outline-none focus:ring-0 text-foreground placeholder:text-muted-foreground/80 placeholder:font-medium"
          />
        </div>
      </td>
      {menu}
    </tr>
  );
}
