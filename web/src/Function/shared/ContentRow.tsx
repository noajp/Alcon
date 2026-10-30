'use client';

import type { ReactNode } from 'react';

// =============================================================
// ContentRow — one row in a list on a concept's page (the Portfolios under a
// Vision, the Initiatives under a Portfolio, the Initiatives a Domain serves).
//
// The same row as a sidebar list, for the content area: the ROW is the hover
// and focus target, so the name, the figures and the trailing "×" light up as
// one piece, and the row is never a button-shaped capsule. The ground is
// `--muted` because the content area is the card colour — `--sidebar-accent`
// is that same colour in the light themes and would paint nothing.
// =============================================================

export function ContentRow({ icon, name, description, meta, actions, onOpen, indent = 0, body, children }: {
  icon?: ReactNode;
  name: ReactNode;
  /** A quiet line after the name; hidden on narrow widths. */
  description?: ReactNode;
  /** Figures at the right — progress, a count. */
  meta?: ReactNode;
  /** A trailing control, outside the button (use ContentRowAction). */
  actions?: ReactNode;
  onOpen?: () => void;
  /** Pixels of left indent, for a tree. */
  indent?: number;
  /** Replaces the opening button — a rename field, say. Lay it out as a
   *  `flex-1` row of its own. */
  body?: ReactNode;
  /** Before the icon inside the row — a tree's fold arrow. */
  children?: ReactNode;
}) {
  return (
    <div className="group flex min-w-0 items-center rounded-md transition-colors hover:bg-muted/40 has-[:focus-visible]:bg-muted/40" style={indent ? { paddingLeft: indent } : undefined}>
      {children}
      {body ?? (
        <button type="button" onClick={onOpen} disabled={!onOpen}
          className="flex h-8 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left text-[13px] font-medium text-foreground outline-none disabled:cursor-default">
          {icon && <span className="flex w-4 shrink-0 items-center justify-center text-muted-foreground">{icon}</span>}
          <span className="truncate">{name}</span>
          {description && <span className="hidden min-w-0 truncate text-[12px] font-normal text-muted-foreground sm:inline">{description}</span>}
        </button>
      )}
      {meta && <div className="flex shrink-0 items-center gap-3 pr-2 text-[11px] tabular-nums text-muted-foreground">{meta}</div>}
      {actions && <div className="flex shrink-0 items-center pr-1">{actions}</div>}
    </div>
  );
}

/** A trailing control in a ContentRow — shown on row hover or focus. */
export function ContentRowAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className="flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-[opacity,color] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100">
      {children}
    </button>
  );
}
