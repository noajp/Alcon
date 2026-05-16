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

// Three-tab top strip sitting above AppSidebar. Active button shows icon
// AND label; inactive buttons collapse to icon only (per the "non-selected
// button is icon only, selected is icon + 'Home'" spec).
export function ModeStrip({ activeMode, onChange }: ModeStripProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-border/40 bg-card">
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const isActive = activeMode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            className={`inline-flex items-center gap-1.5 h-7 rounded-md text-[12px] font-semibold transition-colors ${
              isActive
                ? 'bg-sidebar-accent text-foreground px-2.5'
                : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground w-7 justify-center'
            }`}
            title={b.label}
            aria-label={b.label}
          >
            <Icon size={14} />
            {isActive && <span>{b.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
