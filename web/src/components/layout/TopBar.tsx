'use client';

import { Search } from 'lucide-react';

interface TopBarProps {
  systemName?: string;
}

/**
 * Top bar:
 *  - Left: theme-aware Alcon SVG logo (switches via `dark:` Tailwind variant)
 *  - Center: search bar
 *  - Right: reserved for system/user (kept minimal for now)
 */
export function TopBar({ systemName }: TopBarProps) {
  return (
    <div className="h-12 flex items-center bg-sidebar border-b border-sidebar-border flex-shrink-0">
      {/* Left: theme-aware Alcon logo */}
      <div className="pl-3 pr-2 flex items-center flex-shrink-0">
        <img
          src="/alcon-logo-primary.svg"
          alt="Alcon"
          className="h-8 w-auto dark:hidden"
        />
        <img
          src="/alcon-logo-reverse.svg"
          alt="Alcon"
          className="h-8 w-auto hidden dark:block"
        />
        {systemName && (
          <>
            <span className="text-muted-foreground/40 text-xs ml-3 mr-2">/</span>
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

      {/* Right: reserved */}
      <div className="px-3 flex items-center justify-end flex-shrink-0" />
    </div>
  );
}
