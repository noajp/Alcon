'use client';

import { useState } from 'react';

interface TitleBarProps {
  onToggleAI: () => void;
  isAIPanelOpen: boolean;
}

export function TitleBar({ onToggleAI, isAIPanelOpen }: TitleBarProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="h-[var(--titlebar-height)] flex items-center justify-between px-4 bg-[var(--bg-tertiary)] border-b border-[var(--border-color)]">
      {/* Left - Logo & Menu */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-[var(--accent-primary)]">&#9670;</span>
          <span className="font-semibold text-[var(--text-primary)]">Alcon</span>
        </div>
      </div>

      {/* Center - Search */}
      <div className="flex-1 max-w-md mx-4">
        <div
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-primary)] border border-[var(--border-color)] rounded cursor-pointer hover:border-[var(--accent-primary)]"
        >
          <span className="text-[var(--text-muted)]">&#128269;</span>
          <span className="text-sm text-[var(--text-muted)]">Search tasks, docs, people... (&#8984;K)</span>
        </div>
      </div>

      {/* Right - Actions */}
      <div className="flex items-center gap-2">
        {/* Notifications */}
        <button className="relative w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded">
          <span>&#128276;</span>
          <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[var(--status-error)]" />
        </button>

        {/* AI Toggle */}
        <button
          onClick={onToggleAI}
          className={`w-8 h-8 flex items-center justify-center rounded ${
            isAIPanelOpen
              ? 'bg-[var(--accent-primary)] text-white'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          }`}
        >
          &#129302;
        </button>

        {/* User */}
        <button className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--accent-primary)] text-white text-sm">
          T
        </button>
      </div>

      {/* Search Modal */}
      {searchOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-start justify-center pt-[15vh] z-50"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-2xl bg-[var(--bg-secondary)] rounded-lg shadow-2xl border border-[var(--border-color)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border-color)]">
              <span className="text-[var(--text-muted)]">&#128269;</span>
              <input
                type="text"
                placeholder="Search tasks, documents, people..."
                autoFocus
                className="flex-1 bg-transparent text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              />
              <kbd className="px-2 py-0.5 text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded">esc</kbd>
            </div>

            {/* Recent */}
            <div className="p-2">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Recent</div>
              {[
                { icon: '&#128203;', name: 'API Design', type: 'Task' },
                { icon: '&#128196;', name: 'API Specification.md', type: 'Document' },
                { icon: '&#128194;', name: 'Website Redesign', type: 'Project' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <span dangerouslySetInnerHTML={{ __html: item.icon }} />
                  <span className="flex-1">{item.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">{item.type}</span>
                </div>
              ))}
            </div>

            {/* Commands */}
            <div className="p-2 border-t border-[var(--border-color)]">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">Commands</div>
              {[
                { icon: '&#10133;', name: 'Create new task', shortcut: '&#8984;N' },
                { icon: '&#129302;', name: 'Ask AI...', shortcut: '&#8984;&#8679;A' },
                { icon: '&#128274;', name: 'View version history', shortcut: '&#8984;&#8679;H' },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-3 py-2 rounded hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <span dangerouslySetInnerHTML={{ __html: item.icon }} />
                  <span className="flex-1">{item.name}</span>
                  <kbd
                    className="px-2 py-0.5 text-xs text-[var(--text-muted)] bg-[var(--bg-tertiary)] rounded"
                    dangerouslySetInnerHTML={{ __html: item.shortcut }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
