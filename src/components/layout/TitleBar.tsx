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
      <div className="h-[var(--titlebar-height)] flex items-center justify-between px-4 bg-[var(--bg-surface)] border-b border-[var(--border-default)]">
        {/* Left: Logo */}
        <div className="flex items-center gap-2.5 min-w-[160px]">
          <div className="w-6 h-6 rounded bg-[var(--text-primary)] flex items-center justify-center">
            <span className="text-xs font-bold text-[var(--bg-base)]">A</span>
          </div>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            Alcon
          </span>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 flex justify-center max-w-lg mx-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full max-w-sm flex items-center gap-2.5 px-3 py-1.5 bg-[var(--bg-overlay)] border border-[var(--border-default)] rounded-md text-left hover:border-[var(--border-strong)] hover:bg-[var(--bg-muted)] transition-colors"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-[var(--text-muted)]"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>

            <span className="flex-1 text-xs text-[var(--text-muted)]">
              Search...
            </span>

            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-[var(--bg-muted)] text-[var(--text-faint)] rounded border border-[var(--border-default)]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 min-w-[160px] justify-end">
          {/* Notifications */}
          <button className="relative p-2 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-muted)] transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[var(--status-error)]" />
          </button>

          {/* User avatar */}
          <button className="ml-1 p-0.5 rounded-md hover:bg-[var(--bg-muted)] transition-colors">
            <div className="w-7 h-7 rounded-md bg-[var(--bg-subtle)] border border-[var(--border-default)] flex items-center justify-center text-xs font-medium text-[var(--text-secondary)]">
              N
            </div>
          </button>
        </div>
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-[100]"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-[var(--bg-surface)] rounded-lg border border-[var(--border-default)] shadow-2xl overflow-hidden animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-default)]">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-[var(--text-muted)]"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Search tasks, projects, members..."
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-[var(--text-primary)] text-sm placeholder-[var(--text-faint)] focus:outline-none"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-faint)] bg-[var(--bg-muted)] rounded border border-[var(--border-default)]">
                esc
              </kbd>
            </div>

            {/* Recent Items */}
            <div className="p-2">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-medium">
                Recent
              </div>
              {[
                { icon: '📋', name: 'API Design Review', type: 'Task' },
                { icon: '📁', name: 'Website Redesign', type: 'Project' },
                { icon: '👤', name: 'Tanaka Kenji', type: 'Member' },
              ].map((item, i) => (
                <button
                  key={i}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[var(--bg-muted)] cursor-pointer transition-colors text-left"
                >
                  <span className="text-sm">{item.icon}</span>
                  <span className="flex-1 text-sm text-[var(--text-primary)]">{item.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-muted)] text-[var(--text-muted)]">
                    {item.type}
                  </span>
                </button>
              ))}
            </div>

            {/* Commands */}
            <div className="p-2 border-t border-[var(--border-default)]">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-faint)] font-medium">
                Commands
              </div>
              {[
                { icon: '➕', name: 'Create new task', shortcut: '⌘ N' },
                { icon: '🤖', name: 'Ask AI assistant', shortcut: '⌘ ⇧ A' },
              ].map((item, i) => (
                <button
                  key={i}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:bg-[var(--bg-muted)] cursor-pointer transition-colors text-left"
                >
                  <span className="text-sm">{item.icon}</span>
                  <span className="flex-1 text-sm text-[var(--text-primary)]">{item.name}</span>
                  <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-[var(--text-faint)] bg-[var(--bg-muted)] rounded border border-[var(--border-default)]">
                    {item.shortcut}
                  </kbd>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 bg-[var(--bg-overlay)] border-t border-[var(--border-default)] flex items-center gap-4 text-[10px] text-[var(--text-faint)]">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-[var(--bg-muted)] rounded">↵</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-[var(--bg-muted)] rounded">↑↓</kbd>
                navigate
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
