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
      <div className="h-[var(--titlebar-height)] flex items-center justify-between px-4 bg-white border-b border-gray-100">
        {/* Left: Logo */}
        <div className="flex items-center gap-2.5 min-w-[140px]">
          <div className="w-6 h-6 rounded-lg bg-gray-900 flex items-center justify-center shadow-sm">
            <span className="text-[11px] font-bold text-white">A</span>
          </div>
          <span className="text-sm font-semibold text-gray-900 tracking-tight">
            Alcon
          </span>
        </div>

        {/* Center: Search Bar */}
        <div className="flex-1 flex justify-center max-w-md mx-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full max-w-xs flex items-center gap-2.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-left hover:border-gray-300 hover:bg-gray-100 transition-all duration-150 group"
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
              className="text-gray-400 group-hover:text-gray-500"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>

            <span className="flex-1 text-xs text-gray-400 group-hover:text-gray-500">
              Search...
            </span>

            <kbd className="px-1.5 py-0.5 text-[10px] font-medium font-mono bg-white text-gray-400 rounded border border-gray-200 shadow-sm">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1 min-w-[160px] justify-end">
          {/* Notifications */}
          <button className="relative p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all duration-150">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white" />
          </button>

          {/* User avatar */}
          <button className="ml-1 p-0.5 rounded-lg hover:bg-gray-100 transition-all duration-150">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 border border-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 shadow-sm">
              N
            </div>
          </button>
        </div>
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] z-[100]"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl bg-white rounded-xl border border-gray-200 shadow-2xl overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-gray-400"
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
                className="flex-1 bg-transparent text-gray-900 text-sm placeholder-gray-400 focus:outline-none"
              />
              <kbd className="px-1.5 py-0.5 text-[10px] font-medium font-mono text-gray-400 bg-gray-100 rounded border border-gray-200">
                esc
              </kbd>
            </div>

            {/* Recent Items */}
            <div className="p-2">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-gray-400 font-medium">
                Recent
              </div>
              {[
                { icon: '📋', name: 'API Design Review', type: 'Task' },
                { icon: '📁', name: 'Website Redesign', type: 'Project' },
                { icon: '👤', name: 'Tanaka Kenji', type: 'Member' },
              ].map((item, i) => (
                <button
                  key={i}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-all duration-150 text-left group"
                >
                  <span className="text-base">{item.icon}</span>
                  <span className="flex-1 text-sm text-gray-700 group-hover:text-gray-900">{item.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">
                    {item.type}
                  </span>
                </button>
              ))}
            </div>

            {/* Commands */}
            <div className="p-2 border-t border-gray-100">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-gray-400 font-medium">
                Commands
              </div>
              {[
                { icon: '➕', name: 'Create new task', shortcut: '⌘ N' },
                { icon: '🤖', name: 'Ask AI assistant', shortcut: '⌘ ⇧ A' },
              ].map((item, i) => (
                <button
                  key={i}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 cursor-pointer transition-all duration-150 text-left group"
                >
                  <span className="text-base">{item.icon}</span>
                  <span className="flex-1 text-sm text-gray-700 group-hover:text-gray-900">{item.name}</span>
                  <kbd className="px-1.5 py-0.5 text-[10px] font-medium font-mono text-gray-400 bg-gray-100 rounded border border-gray-200">
                    {item.shortcut}
                  </kbd>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-4 text-[11px] text-gray-400">
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-200 shadow-sm font-medium">↵</kbd>
                <span>select</span>
              </span>
              <span className="flex items-center gap-1.5">
                <kbd className="px-1.5 py-0.5 bg-white rounded border border-gray-200 shadow-sm font-medium">↑↓</kbd>
                <span>navigate</span>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
