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
    // pl-[5px] aligns the active button's icon with the nav rows' icon
    // column below (nav has px-2 + button px-2.5 → icon at 18px from
    // sidebar edge; here pl-[5px] + button px-3 + 1px border ≈ 18px).
    <div className="flex items-center gap-1.5 pl-[5px] pr-2 py-2">
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const isActive = activeMode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            className={`inline-flex items-center h-7 rounded-full text-[12px] font-medium transition-colors border ${
              isActive
                ? 'bg-muted text-foreground border-border gap-1.5 px-3'
                : 'text-muted-foreground border-border/50 hover:text-foreground hover:bg-muted/40 hover:border-border w-7 justify-center'
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
