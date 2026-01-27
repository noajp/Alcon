'use client';

import { useState, useEffect } from 'react';

interface TitleBarProps {
  onSearch?: (query: string) => void;
}

export function TitleBar({ onSearch }: TitleBarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(searchQuery);
    setSearchOpen(false);
  };

  return (
    <>
      <div className="h-10 flex items-center justify-between px-4 bg-sidebar border-b border-sidebar-border">
        {/* Left: Logo */}
        <div className="flex items-center gap-2 min-w-[120px]">
          <div className="w-6 h-6 rounded bg-foreground flex items-center justify-center">
            <span className="text-[11px] font-bold text-background">A</span>
          </div>
          <span className="text-sm font-semibold text-foreground">
            Alcon
          </span>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 flex justify-center max-w-md mx-8">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full max-w-xs flex items-center gap-2 px-2.5 py-[3px] bg-card border border-border rounded-md text-left hover:border-muted-foreground/50 transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted-foreground"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <span className="flex-1 text-xs text-muted-foreground">
              Search...
            </span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted rounded border border-border">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Empty for now */}
        <div className="min-w-[120px]" />
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-[100]"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-popover rounded-lg border border-border shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-muted-foreground"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Search..."
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-foreground text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-muted rounded border border-border">
                esc
              </kbd>
            </div>

            {/* Empty state */}
            <div className="p-8 text-center text-muted-foreground text-sm">
              Type to search...
            </div>
          </div>
        </div>
      )}
    </>
  );
}
