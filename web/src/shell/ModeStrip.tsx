'use client';

import { Hash } from 'lucide-react';
import { NavHomeIcon, NavChatIcon, NavNoteIcon } from '@/shell/sidebar/NavIcons';

export type StripMode = 'home' | 'room' | 'chat' | 'note';

interface ModeStripProps {
  activeMode: StripMode;
  onChange: (mode: StripMode) => void;
}

const BUTTONS: { id: StripMode; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { id: 'home', icon: NavHomeIcon, label: 'Home' },
  { id: 'room', icon: Hash,        label: 'Room' },
  { id: 'chat', icon: NavChatIcon, label: 'Chat' },
  { id: 'note', icon: NavNoteIcon, label: 'Note' },
];

// Top strip rendered inside the AppSidebar, above Action Space. Active
// button reads as a filled pill ("端子っぽい") with icon + label; inactive
// buttons collapse to a small icon-only chip so the strip stays tight at
// the 240px sidebar width.
export function ModeStrip({ activeMode, onChange }: ModeStripProps) {
  return (
    // The parent nav already supplies the same outer padding used by the
    // rows below; keep this wrapper unpadded so the active Home icon lands
    // in that shared column.
    <div className="flex items-center gap-1.5 py-1.5">
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const isActive = activeMode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            className={`inline-flex items-center h-7 rounded-full text-xs font-bold transition-colors flex-shrink-0 ${
              isActive
                ? 'bg-muted text-foreground border border-border gap-1.5 pl-[9px] pr-3'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 w-7 justify-center'
            }`}
            title={b.label}
            aria-label={b.label}
          >
            <Icon size={16} />
            {isActive && <span>{b.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
