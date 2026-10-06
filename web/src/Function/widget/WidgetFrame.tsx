'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus } from 'lucide-react';
import { CARD } from '@/shared/designTokens';
import { Button } from '@/ui/button';
import { RailCard } from '@/Function/shared/RailCard';
import type { FrameVariant } from './types';

// =============================================================
// WidgetFrame — the box every widget wears, and the long press that puts the
// board into arrange mode.
//
// The frame was not invented here. `RailCard` — the collapsible island the
// Properties rail is already made of — IS the widget frame; the island
// variant renders it verbatim, so a widget and a hand-placed rail card are
// the same object to the eye. The `section` variant is the other look this
// app already had (heading + hairline-bordered body, as Milestones and Child
// Objects are drawn today), and `band` is the full-width strip.
//
// Which one a widget wears follows from its zone, never from the widget. The
// old WidgetCard let a widget opt out of the frame entirely (`bare`), which
// is why the Home dashboard had one block that was not in a box.
// =============================================================

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 8;

// ─── Empty signal ────────────────────────────────────────────
// A widget with nothing to say should not leave an empty box behind — but it
// must still be visible while arranging, or it could never be removed. So it
// reports emptiness upward and the frame decides.
//
// The frame HIDES rather than unmounts, and that is load-bearing: unmounting
// the body would run this hook's cleanup, which reports "not empty", which
// re-shows the body, which reports empty again — an infinite loop, because the
// thing being unmounted is the only thing that knows the answer. Hidden, the
// widget stays mounted and keeps its answer current.
const EmptyContext = createContext<((empty: boolean) => void) | null>(null);

/** Call from a widget body: `useWidgetEmpty(entries.length === 0)`. */
export function useWidgetEmpty(empty: boolean): void {
  const report = useContext(EmptyContext);
  useEffect(() => {
    report?.(empty);
    return () => report?.(false);
  }, [empty, report]);
}

// ─── Header meta ─────────────────────────────────────────────
// One short string the widget can put at the right of its own header — "12",
// "3 open". A string rather than a node on purpose: a node would be a new
// object every render and the effect that reports it would never settle.
const MetaContext = createContext<((meta: string | null) => void) | null>(null);

/** Call from a widget body, e.g. `useWidgetMeta(String(count))`. */
export function useWidgetMeta(meta: string | null): void {
  const report = useContext(MetaContext);
  useEffect(() => {
    report?.(meta);
    return () => report?.(null);
  }, [meta, report]);
}

// ─── Header actions ──────────────────────────────────────────
// Some widgets are not only read: the Initiative's Measures, Assumptions and
// Decisions each open a composer from a `+` in their own header. That is a
// node, not a string, so it cannot travel the way `useWidgetMeta` does — a new
// element every render would keep the reporting effect from ever settling.
// It travels as a portal instead: the frame offers a slot in its header, the
// widget renders into it. Being a DOM child of the header also means arrange
// mode's `pointer-events-none` reaches it, so a `+` cannot be pressed while
// the board is being rearranged.
const HeaderSlotContext = createContext<HTMLElement | null>(null);

/** Wrap controls a widget wants in its own frame header. */
export function WidgetHeaderAction({ children }: { children: React.ReactNode }) {
  const node = useContext(HeaderSlotContext);
  return node ? createPortal(children, node) : null;
}

export interface WidgetFrameProps {
  variant: FrameVariant;
  title: string;
  arranging: boolean;
  isDragging?: boolean;
  /** Body sits flush (tables draw their own edges). */
  padded?: boolean;
  onLongPress: () => void;
  onRemove: () => void;
  children: React.ReactNode;
}

/**
 * The springboard minus badge.
 *
 * Anchored to the BOX, not to the frame — in the `section` variant the title
 * is a heading that sits above the box, and a badge on the frame's own corner
 * lands on the first letters of that heading.
 */
function RemoveBadge({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <Button
      variant="secondary"
      size="icon-xs"
      aria-label={`Remove ${title}`}
      // Pill on something pressable is normally wrong (DESIGN.md §5.7 reserves
      // it for badges) — this is the exception the rule describes: a badge
      // overlaid on a corner, not a control in a row. Neutral rather than
      // danger, because it removes a block from a layout, not data.
      className="animate-fade-in absolute -top-2 -left-2 z-20 rounded-full border border-[var(--border-strong)] shadow-[var(--shadow-island)]"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <Minus size={14} />
    </Button>
  );
}

export function WidgetFrame({
  variant,
  title,
  arranging,
  isDragging = false,
  padded = true,
  onLongPress,
  onRemove,
  children,
}: WidgetFrameProps) {
  const [empty, setEmpty] = useState(false);
  const reportEmpty = useCallback((next: boolean) => setEmpty(next), []);
  const [meta, setMeta] = useState<string | null>(null);
  const reportMeta = useCallback((next: string | null) => setMeta(next), []);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Set the moment the press fires, so the pointerup that follows cannot also
  // land as a click on whatever sat under the finger (a Properties picker,
  // say). Cleared on the next tick after that click would have arrived.
  const swallowClick = useRef(false);

  const cancelPress = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  useEffect(() => cancelPress, [cancelPress]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (arranging) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Editing controls own their pointer gestures. A menu can move pointerup
    // into a portal, so arming a press on its trigger would enter arrange mode
    // while the person is choosing a value.
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, input, textarea, select, [role="menuitem"], [role="checkbox"], [contenteditable="true"], [data-no-arrange]')) return;

    // Armed per press. A press that fires but produces no click — lift the
    // finger outside the card and the browser dispatches none — would
    // otherwise leave this set and swallow the next, unrelated click.
    swallowClick.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      swallowClick.current = true;
      onLongPress();
    }, LONG_PRESS_MS);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (timer.current === null || !origin.current) return;
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) cancelPress();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  // Arrange mode is shown, not animated. A looping wobble is the one kind of
  // motion this app does not do (DESIGN.md §7: motion is functional and
  // short) — and at the size of a full-width band it reads as the page
  // shaking rather than the widget being loose. A dashed outline says
  // "detached, draggable" and then holds still.
  const arrangeChrome = arranging
    ? 'cursor-grab active:cursor-grabbing outline-dashed outline-1 outline-offset-4 outline-[var(--border-strong)] rounded-lg'
    : '';

  const body = (
    <EmptyContext.Provider value={reportEmpty}>
      <MetaContext.Provider value={reportMeta}>
        <HeaderSlotContext.Provider value={headerSlot}>{children}</HeaderSlotContext.Provider>
      </MetaContext.Provider>
    </EmptyContext.Provider>
  );

  const headerNode = (
    // `data-no-arrange`: the header is chrome, and its controls are things you
    // press and hold while a menu opens and you read it. Arming the long press
    // there turns "choose an axis" into "rearrange the board".
    <span data-no-arrange className="flex min-w-0 max-w-[60%] items-center gap-2">
      {meta && (
        <span className="min-w-0 truncate text-[11px] text-muted-foreground tabular-nums">{meta}</span>
      )}
      <span ref={setHeaderSlot} className="flex shrink-0 items-center gap-2" />
    </span>
  );

  return (
    <div
      data-widget
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      onClickCapture={handleClickCapture}
      onContextMenu={(e) => {
        // The touch callout would otherwise fire at the same moment the
        // press does, putting a system menu over the mode we just entered.
        if (arranging || timer.current !== null) e.preventDefault();
      }}
      className={`relative ${arrangeChrome} ${isDragging ? 'opacity-50' : ''} ${
        arranging ? 'touch-none' : ''
      } ${empty && !arranging ? 'hidden' : ''}`}
    >
      {/* The whole card goes inert while arranging — chrome included, so a tap
          on the island's own collapse header does not fire either. Events fall
          through to this wrapper, which is where the drag listeners live; the
          remove badge sits outside it and stays live. */}
      <div className={arranging ? 'pointer-events-none' : undefined}>
        {variant === 'island' && (
          <div className="relative">
            <RailCard title={title} padded={padded} action={headerNode}>
              {body}
            </RailCard>
          </div>
        )}

        {variant === 'section' && (
          // The frame closes over the title: one box per widget, with its
          // name inside it. A heading floating above an unrelated box reads
          // as two things, which is wrong the moment the box can be picked up
          // and moved.
          <section className="relative">
            <div className="rounded-lg border border-border/60 bg-card overflow-hidden">
              {/* The title row is a plain heading inside the box — no tinted
                  band. The hairline under it is `--border-subtle` (a divider
                  inside one surface) so a full-bleed body (a table) does not
                  start flush against the title. */}
              <div className="flex items-center justify-between h-10 px-4 border-b border-[var(--border-subtle)]">
                <h2 className="min-w-0 truncate text-[13px] font-medium text-foreground/90">{title}</h2>
                {headerNode}
              </div>
              <div className={padded ? 'px-4 py-3' : ''}>{body}</div>
            </div>
          </section>
        )}

        {variant === 'band' && (
          <div className="relative">
            <div className={`${CARD} h-10 px-4 flex items-center gap-3 overflow-hidden`}>
              <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{title}</span>
              <div className="flex-1 min-w-0">{body}</div>
              {headerNode}
            </div>
          </div>
        )}
      </div>
      {arranging && <RemoveBadge title={title} onRemove={onRemove} />}
    </div>
  );
}
