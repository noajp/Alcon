'use client';

import { Home, MessageSquare, Hash } from 'lucide-react';

export type StripMode = 'home' | 'room' | 'chat';

interface ModeStripProps {
  activeMode: StripMode;
  onChange: (mode: StripMode) => void;
}

const BUTTONS: { id: StripMode; icon: typeof Home; label: string }[] = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'room', icon: Hash, label: 'Room' },
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
];

// Top strip rendered inside the AppSidebar, above Action Space. Active
// button reads as a filled pill ("端子っぽい") with icon + label; inactive
// buttons collapse to a small icon-only chip so the strip stays tight at
// the 240px sidebar width.
export function ModeStrip({ activeMode, onChange }: ModeStripProps) {
  return (
    // Matches the nav rows' outer/inner padding exactly: nav has px-2
    // (8px) + button px-2.5 (10px). Without a border on the active pill,
    // the icon lands at 8 + 10 = 18px — the same column as the Inbox /
    // Strategy / Note icons below.
    <div className="flex items-center gap-1.5 px-2 py-2">
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const isActive = activeMode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            className={`inline-flex items-center h-7 rounded-full text-[12px] font-medium transition-colors ${
              isActive
                ? 'bg-muted text-foreground gap-2.5 px-2.5'
                : 'text-muted-foreground hover:text-foreground w-7 justify-center'
            }`}
            title={b.label}
            aria-label={b.label}
          >
            <Icon size={15} />
            {isActive && <span>{b.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
