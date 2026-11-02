'use client';

import { Fragment, type ReactNode } from 'react';
import { MoreHorizontal } from '@/ui/icons';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/ui/context-menu';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/dropdown-menu';

// One list of actions, offered two ways: on right-click over a row, and from
// a visible "…" button (on the row while it is hovered, or beside a page's
// title). Both show the same items in the same order, so what right-click
// does is never a secret.

export interface ActionItem {
  key: string;
  label: string;
  icon: ReactNode;
  /** Runs after the menu has closed, so an input or picker it opens keeps focus. */
  onSelect: () => void;
  destructive?: boolean;
  /** A rule above this item. */
  separatorBefore?: boolean;
}

const later = (fn: () => void) => () => { setTimeout(fn, 0); };

/** Right-click on the children opens the actions. */
export function ActionsContextMenu({ items, children }: { items: ActionItem[]; children: ReactNode }) {
  if (items.length === 0) return <>{children}</>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      {/* Focus is not handed back to the row on close: an input or picker
          opened from here must keep it. */}
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem variant={item.destructive ? 'destructive' : 'default'} onSelect={later(item.onSelect)}>
              {item.icon}{item.label}
            </ContextMenuItem>
          </Fragment>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The "…" button that opens the same actions. */
export function ActionsButton({ items, label, align = 'start' }: { items: ActionItem[]; label: string; align?: 'start' | 'end' }) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} title={label} onClick={(e) => e.stopPropagation()}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground data-[state=open]:bg-muted/40 data-[state=open]:text-foreground">
          {/* Half a pixel up keeps the dots crisp on a half-pixel row centre. */}
          <MoreHorizontal size={14} className="-translate-y-[0.5px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-[190px]" onCloseAutoFocus={(e) => e.preventDefault()}>
        {items.map((item) => (
          <Fragment key={item.key}>
            {item.separatorBefore && <DropdownMenuSeparator />}
            <DropdownMenuItem variant={item.destructive ? 'destructive' : 'default'} onSelect={later(item.onSelect)} className="text-[13px]">
              {item.icon}{item.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
