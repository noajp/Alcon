'use client';

import type { ReactNode } from 'react';

// =============================================================
// IndexList — a concept's index page: every Initiative, every Portfolio.
//
// Three columns, the same on each: the name, how it is going (Health), and a
// count of what is inside it. A row is a line on the page, not a card: the
// whole row lights up on hover, and the headings above name the columns once.
//
// Initiatives and Portfolios are the same shape of page, so they share this
// rather than each drawing its own: a row's name, its health cell and its
// count are the caller's, the geometry is here.
// =============================================================

const COLUMNS = 'grid-cols-[1fr_minmax(0,18rem)_120px]';

export function IndexList({ headers, showHeader = true, withActions = false, children }: {
  /** The three column headings: name, health, count. */
  headers: [string, string, string];
  /** A second list under the first leaves the headings out. */
  showHeader?: boolean;
  /** The rows carry a "…" after the card; the headings make room for it. */
  withActions?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="px-2 pb-2 pt-2">
      {showHeader && (
        <div className={`sticky top-0 z-10 grid ${COLUMNS} gap-3 bg-card px-4 py-2 text-[13px] font-normal text-muted-foreground ${withActions ? 'mr-7' : ''}`}>
          <span>{headers[0]}</span>
          <span>{headers[1]}</span>
          <span className="text-right">{headers[2]}</span>
        </div>
      )}
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function IndexRow({ icon, name, description, health, count, onOpen, indent = 0, lead, renameField, actions }: {
  icon: ReactNode;
  name: ReactNode;
  /** A quiet line after the name; hidden on narrow widths. */
  description?: ReactNode;
  health: ReactNode;
  count: ReactNode;
  onOpen?: () => void;
  /** Pixels of left indent, for a tree of rows. */
  indent?: number;
  /** Outside the card, before it — a tree's fold arrow. */
  lead?: ReactNode;
  /** Replaces the name while it is being renamed. The card is not a button then. */
  renameField?: ReactNode;
  /** After the card — a "…" that shows while the row is hovered or its menu is open. */
  actions?: ReactNode;
}) {
  const card = `grid min-h-11 min-w-0 flex-1 ${COLUMNS} items-center gap-3 rounded-md px-4 py-2.5 text-left transition-colors`;
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        {renameField ?? (
          <>
            <span className="truncate text-[14px] font-medium text-foreground">{name}</span>
            {description && <span className="hidden min-w-0 truncate text-[13px] font-normal text-muted-foreground sm:inline">{description}</span>}
          </>
        )}
      </div>
      {health}
      <span className="text-right text-[13px] tabular-nums text-muted-foreground">{count}</span>
    </>
  );
  return (
    <div className="group flex items-center gap-1" style={indent ? { paddingLeft: indent } : undefined}>
      {lead}
      {renameField
        ? <div className={card}>{content}</div>
        : <button type="button" onClick={onOpen} className={`${card} bg-transparent outline-none hover:bg-muted/40 focus-visible:bg-muted/40`}>{content}</button>}
      {actions && (
        <div className="flex w-6 shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
