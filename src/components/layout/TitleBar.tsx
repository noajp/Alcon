'use client';

import { useState, useEffect } from 'react';

interface TitleBarProps {
  onSearch?: (query: string) => void;
  rightContent?: React.ReactNode;
}

export function TitleBar({ onSearch, rightContent }: TitleBarProps) {
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
      <div className="h-12 flex items-center justify-between px-6 bg-background border-b border-border/60">
        {/* Left: Breadcrumb / Title area */}
        <div className="flex items-center gap-3 min-w-[160px]">
          <span className="text-sm font-semibold text-foreground tracking-tight">
            Alcon
          </span>
          <span className="text-border">/</span>
          <span className="text-sm text-muted-foreground">
            Workspace
          </span>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 flex justify-center max-w-md mx-8">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full max-w-sm flex items-center gap-2.5 px-3.5 py-2 bg-muted/50 border border-border/50 rounded-xl text-left hover:border-border hover:bg-muted transition-all duration-200"
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
            <span className="flex-1 text-sm text-muted-foreground">
              Search...
            </span>
            <kbd className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground bg-background rounded-md border border-border/60">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Layout controls and other actions */}
        <div className="min-w-[160px] flex items-center justify-end gap-2">
          {rightContent}
        </div>
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] z-[100]"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-lg bg-background rounded-2xl border border-border shadow-2xl overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-border/60">
              <svg
                width="18"
                height="18"
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
                placeholder="Search objects, elements, notes..."
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-foreground text-sm placeholder:text-muted-foreground focus:outline-none"
              />
              <kbd className="px-2 py-1 text-[10px] font-medium text-muted-foreground bg-muted rounded-md border border-border/60">
                esc
              </kbd>
            </div>

            {/* Empty state */}
            <div className="p-10 text-center text-muted-foreground text-sm">
              Type to search...
            </div>
          </div>
        </div>
      )}
    </>
  );
}
