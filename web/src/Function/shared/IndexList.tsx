'use client';

import type { ReactNode } from 'react';

// =============================================================
// IndexList — a concept's index page: every Strategy, every Domain.
//
// Five columns: the name, how it is going (Health), when it is due, who leads
// it, and a count of what is inside it. A row is a line on the page, not a card: the
// whole row lights up on hover, and the headings above name the columns once.
//
// Index pages are the same shape, so they share this
// rather than each drawing its own: a row's name, its health cell and its
// count are the caller's, the geometry is here.
// =============================================================

// The name takes what is left; the four beside it are fixed, so every row's
// cells stand under the headings and the title always has the room.
const COLUMNS = 'grid-cols-[minmax(0,1fr)_176px_80px_128px_56px]';

export function IndexList({ headers, showHeader = true, withActions = false, children }: {
  /** The five column headings: name, health, due date, lead, count. */
  headers: [string, string, string, string, string];
  /** A second list under the first leaves the headings out. */
  showHeader?: boolean;
  /** The rows carry a "…" after the card; the headings make room for it. */
  withActions?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="px-2 pb-2 pt-2">
      {showHeader && (
        <div className={`sticky top-0 z-10 grid ${COLUMNS} gap-5 bg-card py-2.5 pl-[22px] pr-4 text-[13px] font-normal text-muted-foreground ${withActions ? 'mr-7' : ''}`}>
          <span>{headers[0]}</span>
          <span className="text-right">{headers[1]}</span>
          <span>{headers[2]}</span>
          <span>{headers[3]}</span>
          <span className="text-right">{headers[4]}</span>
        </div>
      )}
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

export function IndexRow({ icon, name, description, health, due, person, count, onOpen, indent = 0, fold, renameField, actions }: {
  icon: ReactNode;
  name: ReactNode;
  /** A quiet line after the name; hidden on narrow widths. */
  description?: ReactNode;
  health: ReactNode;
  /** When it is due. */
  due?: ReactNode;
  /** Who leads it. */
  person?: ReactNode;
  count: ReactNode;
  onOpen?: () => void;
  /** Pixels of left indent, for a tree of rows. */
  indent?: number;
  /** A tree's fold arrow: in the card's left margin, near the edge, so the
   *  icon stays under the "Name" heading. */
  fold?: ReactNode;
  /** Replaces the name while it is being renamed. The card is not a button then. */
  renameField?: ReactNode;
  /** After the card — a "…" that shows while the row is hovered or its menu is open. */
  actions?: ReactNode;
}) {
  const card = `grid min-h-11 min-w-0 flex-1 ${COLUMNS} items-center gap-5 rounded-md py-2.5 pl-[22px] pr-4 text-left transition-colors`;
  const content = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        {renameField ?? (
          <>
            <span className="truncate text-[15px] font-medium text-foreground">{name}</span>
            {description && <span className="hidden min-w-0 truncate text-[13px] font-normal text-muted-foreground sm:inline">{description}</span>}
          </>
        )}
      </div>
      <div className="flex min-w-0 justify-end">{health}</div>
      <span className="truncate text-[13px] tabular-nums text-muted-foreground">{due}</span>
      <div className="flex min-w-0 items-center">{person}</div>
      <span className="text-right text-[13px] tabular-nums text-muted-foreground">{count}</span>
    </>
  );
  return (
    <div className="group relative flex items-center gap-1" style={indent ? { paddingLeft: indent } : undefined}>
      {fold && <div className="absolute top-1/2 z-[1] -translate-y-1/2" style={{ left: indent - 6 }}>{fold}</div>}
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
