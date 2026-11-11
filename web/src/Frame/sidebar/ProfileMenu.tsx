'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

// The account card the sidebar's foot opens: who is signed in, then the
// places that are this person's own and the account's actions, as quiet
// rows under a hairline. One card on the popover ground; arrow keys move
// between the rows like a native menu.

export interface ProfileMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** A small pill at the right, e.g. a count. */
  badge?: string;
  onSelect?: () => void;
  /** Set apart from the rows above it by a hairline (the account's own
   *  actions under the places). */
  separated?: boolean;
}

export function ProfileMenu({ name, email, avatar, items, onOpenProfile }: {
  name: string;
  email: string;
  avatar: ReactNode;
  items: ProfileMenuItem[];
  /** The header opens the person's Profile. */
  onOpenProfile?: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const onKey = (e: KeyboardEvent) => {
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % buttons.length
      : e.key === 'ArrowUp' ? (i - 1 + buttons.length) % buttons.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    buttons[next]?.focus();
  };

  const shownName = name.trim();
  const header = (
    <>
      <span className="size-8 shrink-0 overflow-hidden rounded-full">{avatar}</span>
      <span className="grid min-w-0">
        {shownName && <span className="truncate text-[13px] font-medium text-foreground" title={shownName}>{shownName}</span>}
        <span className="truncate text-[12px] leading-4 text-muted-foreground" title={email}>{email}</span>
      </span>
    </>
  );

  return (
    <div className="w-[260px] rounded-[10px] bg-popover p-1 text-[13px] text-foreground shadow-[var(--shadow-island)] ring-[0.5px] ring-border">
      {onOpenProfile ? (
        <button type="button" onClick={onOpenProfile}
          className="-mx-1 -mt-1 mb-1 flex w-[calc(100%+8px)] items-center gap-2.5 rounded-t-[10px] border-b-[0.5px] border-border px-3 pb-2.5 pt-2 text-left transition-colors hover:bg-muted/50">
          {header}
        </button>
      ) : (
        <div className="-mx-1 -mt-1 mb-1 flex items-center gap-2.5 border-b-[0.5px] border-border px-3 pb-2.5 pt-2">{header}</div>
      )}
      <div ref={listRef} role="menu" aria-label={shownName || email} onKeyDown={onKey} className="grid grid-cols-[minmax(0,1fr)]">
        {items.map((item) => (
          <div key={item.id} className={item.separated ? '-mx-1 mt-1 border-t-[0.5px] border-border px-1 pt-1' : undefined}>
            <button type="button" role="menuitem" onClick={item.onSelect}
              className="group flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-foreground transition-colors duration-150 hover:bg-muted/60 hover:duration-75 focus-visible:bg-muted/60 active:bg-muted">
              <span className="grid size-4 shrink-0 place-items-center text-muted-foreground transition-colors group-hover:text-foreground group-focus-visible:text-foreground">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate" title={item.label}>{item.label}</span>
              {item.badge && (
                <span className="max-w-[50%] shrink-0 truncate rounded-[5px] bg-muted px-1.5 text-[11px] font-medium leading-[18px] text-muted-foreground">{item.badge}</span>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
