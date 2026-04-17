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
    <div className="h-10 flex items-center bg-card border-b border-border flex-shrink-0">
      {/* Brand block — width matches the icon sidebar (w-12) */}
      <div className="w-12 h-full flex items-center justify-center border-r border-border flex-shrink-0">
        <img src="/logo.png" alt="Alcon" className="w-6 h-6 rounded object-cover" />
      </div>

      {/* Brand text + system */}
      <div className="px-3 flex items-center gap-2 min-w-[120px]">
        <span className="text-[13px] font-semibold text-foreground tracking-tight">Alcon</span>
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
            className="w-full h-7 pl-7 pr-3 text-[12px] bg-muted/50 hover:bg-muted/70 focus:bg-background border border-border/60 focus:border-border rounded-md focus:outline-none focus:ring-1 focus:ring-foreground/10 transition-colors"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60 font-mono pointer-events-none">⌘K</span>
        </div>
      </div>

      {/* Right: reserved space (could add notifications/user later) */}
      <div className="px-3 min-w-[120px] flex items-center justify-end">
        {/* Future: notifications, user menu */}
      </div>
    </div>
  );
}
