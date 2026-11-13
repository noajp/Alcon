'use client';

import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A row for lists that are not tabular enough to be a table: a leading slot
// (icon, mark), a title with an optional description, and a trailing slot
// (date, badge, actions). Rows inside a HoverGroup share one highlight that
// glides from row to row under the pointer instead of each row fading its
// own ground in and out.

type Box = { x: number; y: number; w: number; h: number; radius: string };

/** Wraps rows that share one gliding hover highlight. */
export function HoverGroup({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [shown, setShown] = useState(false);
  // Off for the first row the pointer meets, so the highlight appears in
  // place instead of sliding in from where it last was.
  const [glide, setGlide] = useState(false);

  const onPointerOver = (e: PointerEvent) => {
    // A tap also fires pointerover and would leave the highlight stuck.
    if (e.pointerType === 'touch') return;
    const group = ref.current;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-hover-item]');
    // Between rows, or in a nested group: leave it where it is.
    if (!group || !item || item.closest('[data-hover-group]') !== group) return;
    if (item.getAttribute('aria-disabled') === 'true') { setShown(false); return; }
    const g = group.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    setGlide(shown);
    setBox({
      x: r.left - g.left + group.scrollLeft, y: r.top - g.top + group.scrollTop,
      w: r.width, h: r.height, radius: getComputedStyle(item).borderRadius,
    });
    setShown(true);
  };

  return (
    <div ref={ref} data-hover-group="" className={cn('relative', className)}
      onPointerOver={onPointerOver} onPointerLeave={() => setShown(false)}>
      <span aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 bg-foreground/[0.06] duration-200 ease-out"
        style={{
          transform: box ? `translate(${box.x}px, ${box.y}px)` : undefined,
          width: box?.w, height: box?.h, borderRadius: box?.radius,
          opacity: shown ? 1 : 0,
          transitionProperty: glide ? 'transform, width, height, opacity' : 'opacity',
        }} />
      {children}
    </div>
  );
}

export function ListItem({
  title, description, leading, trailing, selected = false, disabled = false, expanded, inline = false, onClick, className,
}: {
  title: ReactNode;
  /** The secondary line, under the title (beside it when `inline`). */
  description?: ReactNode;
  leading?: ReactNode;
  /** May hold its own controls: they sit above the row's click area. */
  trailing?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  /** For a row that opens something beneath it. */
  expanded?: boolean;
  /** One line: the description follows the title instead of sitting under it. */
  inline?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const text = (
    <span className={cn('flex min-w-0 flex-1', inline ? 'items-baseline gap-1.5' : 'flex-col gap-px')}>
      <span className={cn('font-medium text-foreground', inline ? 'shrink-0' : 'truncate')}>{title}</span>
      {description != null && <span dir="auto" className="min-w-0 truncate text-[12px] text-muted-foreground">{description}</span>}
    </span>
  );
  return (
    <div data-hover-item="" aria-disabled={disabled || undefined} aria-current={selected || undefined}
      className={cn(
        'relative flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-[13px] leading-5',
        selected && 'bg-[var(--accent-subtle)]',
        disabled && 'text-muted-foreground',
        className,
      )}>
      {leading != null && <span className="grid shrink-0 place-items-center text-muted-foreground">{leading}</span>}
      {onClick && !disabled ? (
        // The whole row is the click area; the trailing slot sits above it.
        // Keyboard focus tints the row, as the app's fields do.
        <button type="button" onClick={onClick} aria-expanded={expanded}
          className="flex min-w-0 flex-1 rounded-[inherit] text-left outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:bg-foreground/[0.08]">
          {text}
        </button>
      ) : text}
      {trailing != null && <span className="relative z-10 flex shrink-0 items-center gap-1.5">{trailing}</span>}
    </div>
  );
}
