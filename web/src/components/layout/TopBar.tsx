'use client';

import { Search } from 'lucide-react';

interface TopBarProps {
  systemName?: string;
}

/**
 * VSCode-style top bar:
 *  - Left: Alcon logo + brand text (above the icon sidebar)
 *  - Center: search bar
 *  - Right: reserved for system/user (kept minimal for now)
 */
export function TopBar({ systemName }: TopBarProps) {
  return (
    <div className="h-10 flex items-center bg-sidebar border-b border-sidebar-border flex-shrink-0">
      {/* Brand block — width matches the icon sidebar (w-12) */}
      <div className="w-12 h-full flex items-center justify-center border-r border-sidebar-border flex-shrink-0">
        <img src="/logo.png" alt="Alcon" className="w-6 h-6 rounded object-cover" />
      </div>

      {/* Brand text + system */}
      <div className="px-3 flex items-baseline gap-2 min-w-[200px]">
        <span className="text-[13px] font-semibold text-foreground tracking-tight">Alcon</span>
        <span className="text-[11px] text-muted-foreground tracking-tight whitespace-nowrap">
          Strategy Execution Manager
        </span>
        {systemName && (
          <>
            <span className="text-muted-foreground/40 text-xs">/</span>
            <span className="text-[12px] text-muted-foreground truncate max-w-[180px]">{systemName}</span>
          </>
        )}
      </div>

      {/* Center: search */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search Objects, Elements, Tags..."
            className="no-focus-ring w-full h-7 pl-7 pr-3 text-[12px] bg-sidebar-accent/40 hover:bg-sidebar-accent/60 focus:bg-sidebar-accent border border-sidebar-border focus:border-sidebar-border rounded-md focus:outline-none focus:ring-0 transition-colors text-foreground placeholder:text-muted-foreground"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60 font-mono pointer-events-none">⌘K</span>
        </div>
      </div>

      {/* Right: theme-aware Alcon logo */}
      <div className="px-4 flex items-center justify-end flex-shrink-0">
        {/* Light theme: dark-ink logo */}
        <img
          src="/alcon-logo-primary.svg"
          alt="Alcon"
          className="h-6 w-auto dark:hidden"
        />
        {/* Dark theme: light-ink logo */}
        <img
          src="/alcon-logo-reverse.svg"
          alt="Alcon"
          className="h-6 w-auto hidden dark:block"
        />
      </div>
    </div>
  );
}
