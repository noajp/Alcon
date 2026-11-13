'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { ChevronRight, MoreHorizontal } from '@/ui/icons';
import { Button, ButtonAppearanceProvider } from '@/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/dropdown-menu';
import { SidebarReveal } from '@/Function/shared/SidebarReveal';

// The list a screen keeps inside its main island (Inbox, AI, Note): a title
// row that stays put, and under it the body that scrolls — so the scrollbar
// starts below the title. The groups in a body (Pinned, a folder) fold, and
// a group may carry a "…" menu of its own.

/** The panel: header over a scrolling body; fills the island's column. */
export function Panel({ label, children }: { label: string; children: ReactNode }) {
  return <section aria-label={label} className="flex min-h-0 flex-1 flex-col">{children}</section>;
}

/** The title row, level with the other pages' 50px headers: the title at
 *  the left, a count beside it, actions at the right. */
export function PanelHeader({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }) {
  return (
    <header className="flex h-[50px] shrink-0 items-center gap-1.5 border-b border-border/60 bg-card px-3">
      <SidebarReveal />
      <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
      {count ? <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span> : null}
      <div className="flex-1" />
      {actions && <ButtonAppearanceProvider appearance="navigation">{actions}</ButtonAppearanceProvider>}
    </header>
  );
}

/** What scrolls under the header. */
export function PanelBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 pt-1.5">{children}</div>;
}

/** A group in the body: its name (a fold toggle) and, on hover, its "…". */
export function PanelGroup({ title, open, onToggle, menu, children }: {
  title: string;
  open: boolean;
  onToggle: () => void;
  /** The group's "…" items. */
  menu?: { label: string; onSelect: () => void }[];
  children: ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="group/panel-group flex h-7 items-center gap-1 pl-2 pr-1">
        <button type="button" onClick={onToggle} aria-expanded={open}
          className="flex min-w-0 items-center gap-1 rounded-md text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <span className="truncate">{title}</span>
          <ChevronRight size={11} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        </button>
        <div className="flex-1" />
        {menu && menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={title}
                className="opacity-0 group-hover/panel-group:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                <MoreHorizontal size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              {menu.map((item) => (
                <DropdownMenuItem key={item.label} onSelect={item.onSelect} className="text-[13px]">{item.label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && <div className="flex flex-col">{children}</div>}
    </div>
  );
}

/** The ids a person pinned in one list, kept in this browser. */
export function usePinned(key: string) {
  const storageKey = `clayware:pinned:${key}`;
  const [pinned, setPinned] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]');
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const toggle = useCallback((id: string) => {
    setPinned((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* kept for this session */ }
      return next;
    });
  }, [storageKey]);
  return { pinned, isPinned: (id: string) => pinned.includes(id), toggle };
}

/** A search box at the top of the body, shown once Search is pressed. */
export function PanelSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
      onKeyDown={(e) => { if (e.key === 'Escape') onChange(''); }}
      className="mb-1 h-7 w-full rounded-md bg-muted/50 px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground focus:bg-muted/70" />
  );
}
