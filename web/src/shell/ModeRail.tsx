'use client';

import { Hash, Search } from 'lucide-react';
import { NavHomeIcon, NavChatIcon, NavNoteIcon } from '@/shell/sidebar/NavIcons';
import type { StripMode } from '@/shell/ModeStrip';

const BUTTONS: { id: StripMode; icon: React.ComponentType<{ size?: number }>; label: string }[] = [
  { id: 'home', icon: NavHomeIcon, label: 'Home' },
  { id: 'room', icon: Hash,        label: 'Room' },
  { id: 'chat', icon: NavChatIcon, label: 'Chat' },
  { id: 'note', icon: NavNoteIcon, label: 'Note' },
];

interface ModeRailProps {
  activeMode: StripMode;
  onChange: (mode: StripMode) => void;
  onSearch?: () => void;
}

// Always-visible 40px icon rail on the far left — Home / Room / Chat / Note as
// vertical icon buttons, plus a trailing Discover search. Lives OUTSIDE the
// collapsible AppSidebar so the modes stay reachable even when the sidebar is
// hidden or the window is narrow ("サイドバーの隣のサイドバー、常時表示").
export function ModeRail({ activeMode, onChange, onSearch }: ModeRailProps) {
  return (
    <div className="w-10 h-full flex-shrink-0 flex flex-col items-center gap-1 py-2 border-r border-border/40">
      {BUTTONS.map((b) => {
        const Icon = b.icon;
        const isActive = activeMode === b.id;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onChange(b.id)}
            title={b.label}
            aria-label={b.label}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
          >
            <Icon size={17} />
          </button>
        );
      })}
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          title="Discover Domains and Objects"
          aria-label="Discover"
          className="mt-auto inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <Search size={16} />
        </button>
      )}
    </div>
  );
}
